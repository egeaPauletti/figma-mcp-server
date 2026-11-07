import crypto from "node:crypto";
import type { Server, Socket } from "socket.io";
import { getDb } from "../auth/db.js";
import { getUserById } from "../auth/users.js";
import { generateUUID, nowSeconds, randomToken, sha256, unrefTimer } from "../utils.js";

// "auth": plugins must be paired with a user through a pairing code (streamable-http).
// "local": single user on the local machine, no pairing (stdio).
export type RegistryMode = "auth" | "local";

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L
const CODE_LENGTH = 8;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const FAILED_ATTEMPTS_WINDOW_MS = 10 * 60 * 1000;

export interface PluginConnection {
    socketId: string;
    connectedAt: number;
    fileName?: string;
    // Unpaired state
    code?: string;
    codeTimer?: ReturnType<typeof setTimeout>;
    // Paired state
    pairingId?: string;
    userId?: string;
    email?: string;
}

export interface ConnectionSummary {
    connectionId: string;
    fileName: string;
    connectedAt: string;
}

export type PairResult =
    | { ok: true; connection: PluginConnection }
    | { ok: false; error: string };

interface PairingRow {
    id: string;
    user_id: string;
    file_name: string | null;
    revoked: number;
}

export class ConnectionRegistry {
    private bySocket = new Map<string, PluginConnection>();
    private byCode = new Map<string, string>(); // code → socketId
    private failedAttempts = new Map<string, { count: number; resetAt: number }>();

    constructor(private readonly io: Server, private readonly mode: RegistryMode) {
        io.on("connection", (socket) => {
            try {
                this.onConnect(socket);
            } catch (error) {
                console.error("Error registering plugin connection:", error);
            }
        });
    }

    // ---- Socket lifecycle ----

    private onConnect(socket: Socket) {
        const conn: PluginConnection = { socketId: socket.id, connectedAt: Date.now() };
        this.bySocket.set(socket.id, conn);

        socket.on("hello", (data: { fileName?: unknown }) => {
            if (typeof data?.fileName === "string") {
                conn.fileName = data.fileName.slice(0, 200);
                if (conn.pairingId) {
                    getDb().prepare("UPDATE plugin_pairings SET file_name = ? WHERE id = ?").run(conn.fileName, conn.pairingId);
                }
            }
        });

        socket.on("unpair", () => {
            if (conn.pairingId) {
                getDb().prepare("UPDATE plugin_pairings SET revoked = 1 WHERE id = ?").run(conn.pairingId);
            }
            delete conn.pairingId;
            delete conn.userId;
            delete conn.email;
            this.issueCode(socket, conn);
        });

        socket.on("request-pairing-code", () => {
            if (!conn.pairingId && this.mode === "auth") this.issueCode(socket, conn);
        });

        socket.on("disconnect", () => {
            this.clearCode(conn);
            this.bySocket.delete(socket.id);
        });

        if (this.mode === "local") {
            socket.emit("paired", { local: true });
            return;
        }

        // Re-pair automatically with a token saved by the plugin on a previous pairing
        const pluginToken = socket.handshake.auth?.pluginToken;
        if (typeof pluginToken === "string" && pluginToken && this.restorePairing(socket, conn, pluginToken)) {
            return;
        }
        if (typeof pluginToken === "string" && pluginToken) {
            socket.emit("pairing-revoked");
        }
        this.issueCode(socket, conn);
    }

    private restorePairing(socket: Socket, conn: PluginConnection, pluginToken: string): boolean {
        const row = getDb()
            .prepare("SELECT id, user_id, file_name, revoked FROM plugin_pairings WHERE token_hash = ?")
            .get(sha256(pluginToken)) as PairingRow | undefined;
        if (!row || row.revoked === 1) return false;
        const user = getUserById(row.user_id);
        if (!user || user.disabled) return false;

        getDb().prepare("UPDATE plugin_pairings SET last_seen = ? WHERE id = ?").run(nowSeconds(), row.id);
        conn.pairingId = row.id;
        conn.userId = user.id;
        conn.email = user.email;
        socket.emit("paired", { email: user.email });
        return true;
    }

    private issueCode(socket: Socket, conn: PluginConnection) {
        this.clearCode(conn);
        let code: string;
        do {
            code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
        } while (this.byCode.has(code));

        conn.code = code;
        this.byCode.set(code, socket.id);
        // Codes expire; a fresh one is pushed automatically while the plugin stays unpaired
        conn.codeTimer = setTimeout(() => {
            if (this.bySocket.has(socket.id) && !conn.pairingId) this.issueCode(socket, conn);
        }, CODE_TTL_MS);
        unrefTimer(conn.codeTimer);

        socket.emit("pairing-code", {
            code: `${code.slice(0, 4)}-${code.slice(4)}`,
            expiresAt: Date.now() + CODE_TTL_MS,
        });
    }

    private clearCode(conn: PluginConnection) {
        if (conn.codeTimer) clearTimeout(conn.codeTimer);
        if (conn.code) this.byCode.delete(conn.code);
        delete conn.code;
        delete conn.codeTimer;
    }

    // ---- Used by the MCP session tools ----

    // Pairs the plugin that shows `rawCode` with the user.
    public pair(userId: string, rawCode: string): PairResult {
        const attempts = this.failedAttempts.get(userId);
        if (attempts && attempts.resetAt > Date.now() && attempts.count >= MAX_FAILED_ATTEMPTS) {
            return { ok: false, error: "Too many invalid pairing codes. Wait a few minutes and try again." };
        }

        const code = rawCode.toUpperCase().replace(/[^0-9A-Z]/g, "");
        const socketId = this.byCode.get(code);
        const conn = socketId ? this.bySocket.get(socketId) : undefined;
        const socket = socketId ? this.io.sockets.sockets.get(socketId) : undefined;
        if (!conn || !socket) {
            this.registerFailure(userId);
            return { ok: false, error: "Invalid or expired pairing code. Check the code shown in the Figma plugin." };
        }
        const user = getUserById(userId);
        if (!user || user.disabled) {
            return { ok: false, error: "User is disabled" };
        }

        this.failedAttempts.delete(userId);
        this.clearCode(conn);

        const pluginToken = `fmp_${randomToken()}`;
        const pairingId = generateUUID();
        getDb()
            .prepare(`INSERT INTO plugin_pairings (id, token_hash, user_id, file_name, created_at, last_seen, revoked)
                      VALUES (?, ?, ?, ?, ?, ?, 0)`)
            .run(pairingId, sha256(pluginToken), user.id, conn.fileName ?? null, nowSeconds(), nowSeconds());

        conn.pairingId = pairingId;
        conn.userId = user.id;
        conn.email = user.email;
        socket.emit("paired", { email: user.email, pluginToken });
        return { ok: true, connection: conn };
    }

    private registerFailure(userId: string) {
        const now = Date.now();
        const current = this.failedAttempts.get(userId);
        if (!current || current.resetAt <= now) {
            this.failedAttempts.set(userId, { count: 1, resetAt: now + FAILED_ATTEMPTS_WINDOW_MS });
        } else {
            current.count++;
        }
    }

    // Online plugins paired with this user.
    public listForUser(userId: string): PluginConnection[] {
        return [...this.bySocket.values()].filter((c) => c.userId === userId && c.pairingId);
    }

    public getForUser(userId: string, pairingId: string): PluginConnection | undefined {
        return this.listForUser(userId).find((c) => c.pairingId === pairingId);
    }

    // In local mode: the most recently connected plugin.
    public getLocal(): PluginConnection | undefined {
        let latest: PluginConnection | undefined;
        for (const conn of this.bySocket.values()) {
            if (!latest || conn.connectedAt > latest.connectedAt) latest = conn;
        }
        return latest;
    }

    public get isLocal(): boolean {
        return this.mode === "local";
    }

    public summarize(conn: PluginConnection): ConnectionSummary {
        return {
            connectionId: conn.pairingId ?? conn.socketId,
            fileName: conn.fileName ?? "(unknown file)",
            connectedAt: new Date(conn.connectedAt).toISOString(),
        };
    }
}
