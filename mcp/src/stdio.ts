import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFigmaBridge, createMcpServer } from './server.js';
import { config } from './config.js';
import { Server } from 'socket.io';
import http from 'http';

// Local, single user mode: no authentication and no pairing.
// Note: stdout is the MCP channel, so logs must go to stderr.
export async function startSTDIO() {
    try {
        const httpServer = http.createServer();
        const socketServer = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST", "OPTIONS"],
                allowedHeaders: ["*"],
                credentials: false
            },
            transports: ['polling', 'websocket'],
            allowUpgrades: true,
            cookie: false,
            serveClient: false,
            pingTimeout: 60000,
            pingInterval: 25000
        });

        const bridge = createFigmaBridge(socketServer, "local");
        const server = createMcpServer(bridge);
        const transport = new StdioServerTransport();
        await server.connect(transport);

        httpServer.listen(config.PORT, () => {
            console.error(`Socket.IO server listening on http://localhost:${config.PORT}`);
        });
    } catch (error) {
        console.error('Error starting STDIO server:', error);
        throw error;
    }
}
