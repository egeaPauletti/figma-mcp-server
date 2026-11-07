import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ConnectionRegistry } from "../../pairing/connection-registry.js";
import type { SessionTaskRunner } from "../../session.js";

function text(value: unknown, isError = false): CallToolResult {
    return {
        content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
        isError,
    };
}

// Tools that bind the MCP session to a Figma plugin (only registered when authentication is enabled).
export function registerConnectionTools(server: McpServer, runner: SessionTaskRunner, registry: ConnectionRegistry) {
    server.tool(
        "connect-figma",
        "Connect this session to a Figma file. Pass either the pairing code shown in the 'Figma MCP Server' plugin " +
        "(e.g. 'K7Q4-XM2P'), or the connectionId of an already paired file returned by list-figma-connections.",
        {
            code: z.string().optional().describe("Pairing code shown in the Figma plugin"),
            connectionId: z.string().optional().describe("connectionId from list-figma-connections"),
        },
        async ({ code, connectionId }) => {
            const userId = runner.context.userId;
            if (!userId) return text("Not authenticated", true);

            if (connectionId) {
                const conn = registry.getForUser(userId, connectionId);
                if (!conn) return text("No online Figma file with this connectionId. Call list-figma-connections.", true);
                runner.context.pairingId = conn.pairingId!;
                return text({ connected: true, ...registry.summarize(conn) });
            }

            if (!code) return text("Provide the pairing code shown in the Figma plugin, or a connectionId.", true);
            const result = registry.pair(userId, code);
            if (!result.ok) return text(result.error, true);
            runner.context.pairingId = result.connection.pairingId!;
            return text({ connected: true, ...registry.summarize(result.connection) });
        }
    );

    server.tool(
        "list-figma-connections",
        "List the Figma files (open plugins) paired with the current user, and which one this session uses.",
        {},
        async () => {
            const userId = runner.context.userId;
            if (!userId) return text("Not authenticated", true);
            const current = runner.resolveTarget();
            const connections = registry.listForUser(userId).map((c) => ({
                ...registry.summarize(c),
                current: c === current,
            }));
            return text({ user: runner.context.email, connections });
        }
    );
}
