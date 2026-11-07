import express from "express";
import { generateUUID } from "./utils.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createFigmaBridge, createMcpServer } from "./server.js";
import { config } from "./config.js";
import { Server } from "socket.io";
import http from "http";
import { FigmaOAuthProvider, getMcpResourceUrl, SUPPORTED_SCOPES } from "./auth/provider.js";
import { loginRouter } from "./auth/login-route.js";
import { getDb, startPurgeTimer } from "./auth/db.js";
import type { SessionContext } from "./session.js";

interface Session {
    transport: StreamableHTTPServerTransport;
    ownerUserId: string;
    context: SessionContext;
}

function userIdOf(req: express.Request): string | undefined {
    const userId = req.auth?.extra?.userId;
    return typeof userId === "string" ? userId : undefined;
}

export async function startStreamableHTTP() {
    getDb();
    startPurgeTimer();

    const app = express();
    // Behind a reverse proxy (nginx/Caddy): trust X-Forwarded-* for rate limiting and protocol
    app.set("trust proxy", 1);
    app.disable("x-powered-by");

    // CORS (browser based MCP clients, e.g. the MCP Inspector)
    app.use((req, res, next) => {
        const origin = req.headers.origin;
        if (config.ALLOWED_ORIGINS.length === 0) {
            res.header('Access-Control-Allow-Origin', '*');
        } else if (origin && config.ALLOWED_ORIGINS.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
            res.header('Vary', 'Origin');
        }
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, last-event-id');
        res.header('Access-Control-Expose-Headers', 'mcp-session-id, WWW-Authenticate');
        if (req.method === 'OPTIONS') {
            res.sendStatus(204);
        } else {
            next();
        }
    });

    // ---- OAuth 2.1 authorization server ----
    const provider = new FigmaOAuthProvider();
    const mcpUrl = getMcpResourceUrl();
    app.use(mcpAuthRouter({
        provider,
        issuerUrl: new URL(config.PUBLIC_URL),
        resourceServerUrl: mcpUrl,
        scopesSupported: SUPPORTED_SCOPES,
        resourceName: "Figma MCP Server",
    }));
    app.use(loginRouter(provider));

    const requireAuth = requireBearerAuth({
        verifier: provider,
        requiredScopes: SUPPORTED_SCOPES,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
    });

    app.get('/health', (_req, res) => {
        res.json({ ok: true });
    });

    // ---- Socket.IO server for the Figma plugins ----
    const httpServer = http.createServer(app);

    const io = new Server(httpServer, {
        cors: {
            // Figma plugin iframes have a "null" origin; plugins authenticate through pairing instead
            origin: "*",
            methods: ["GET", "POST", "OPTIONS"],
            allowedHeaders: ["*"],
            credentials: false
        },
        // Allow both transports - Socket.IO needs polling for initial handshake
        transports: ['polling', 'websocket'],
        allowUpgrades: true,
        cookie: false,
        serveClient: false,
        pingTimeout: 60000,
        pingInterval: 25000
    });

    io.on('connection', (socket) => {
        console.log('plugin connected:', socket.id);
        socket.on('disconnect', (reason) => {
            console.log('plugin disconnected:', socket.id, reason);
        });
        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });

    io.engine.on('connection_error', (err) => {
        console.error('Socket.IO connection error:', err.message);
    });

    const bridge = createFigmaBridge(io, "auth");

    // ---- MCP endpoint (OAuth protected) ----
    const sessions: { [sessionId: string]: Session } = {};

    // Returns the session only if it belongs to the authenticated user
    const getOwnSession = (req: express.Request): Session | undefined => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId) return undefined;
        const session = sessions[sessionId];
        if (!session || session.ownerUserId !== userIdOf(req)) return undefined;
        return session;
    };

    app.post('/mcp', requireAuth, express.json({ limit: '10mb' }), async (req: express.Request, res: express.Response) => {
        try {
            const userId = userIdOf(req);
            if (!userId) {
                res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
                return;
            }

            const sessionId = req.headers['mcp-session-id'] as string | undefined;
            let transport: StreamableHTTPServerTransport;

            if (sessionId) {
                const session = getOwnSession(req);
                if (!session) {
                    res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
                    return;
                }
                transport = session.transport;
            } else if (isInitializeRequest(req.body)) {
                const email = req.auth?.extra?.email;
                const context: SessionContext = { userId };
                if (typeof email === "string") context.email = email;

                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => generateUUID(),
                    onsessioninitialized: (newSessionId) => {
                        sessions[newSessionId] = { transport, ownerUserId: userId, context };
                    }
                });

                transport.onclose = () => {
                    if (transport.sessionId) {
                        delete sessions[transport.sessionId];
                    }
                };

                // One McpServer per session: an McpServer can only be bound to one transport
                const server = createMcpServer(bridge, context);
                await server.connect(transport as Transport);
            } else {
                res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Bad Request: No valid session ID provided',
                    },
                    id: null,
                });
                return;
            }

            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            console.error('Error handling MCP POST request:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null,
                });
            }
        }
    });

    // Reusable handler for GET and DELETE requests
    const handleSessionRequest = async (req: express.Request, res: express.Response) => {
        try {
            const session = getOwnSession(req);
            if (!session) {
                res.status(404).send('Invalid or missing session ID');
                return;
            }
            await session.transport.handleRequest(req, res);
        } catch (error) {
            console.error('Error handling session request:', error);
            if (!res.headersSent) {
                res.status(500).send('Internal server error');
            }
        }
    };

    // Handle GET requests for server-to-client notifications via SSE
    app.get('/mcp', requireAuth, handleSessionRequest);

    // Handle DELETE requests for session termination
    app.delete('/mcp', requireAuth, handleSessionRequest);

    httpServer.listen(config.PORT, () => {
        console.log(`Server listening on port ${config.PORT}`);
        console.log(`MCP endpoint: ${mcpUrl.href}`);
        console.log(`OAuth issuer: ${config.PUBLIC_URL}`);
    });
}
