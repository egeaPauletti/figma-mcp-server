import path from "path";
import { z } from "zod";
import dotenv from "dotenv";

// quiet: dotenv 17 logs to stdout by default, which corrupts the stdio MCP channel
dotenv.config({ quiet: true });

const intFromEnv = (fallback: number) =>
    z.string().optional().transform((val) => {
        const parsed = val ? Number.parseInt(val, 10) : NaN;
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    });

export const envStartSchema = z.object({
    //* The transport to use for the server. Can be one of 'stdio' or 'streamable-http'.
    //* If not specified, the default is 'stdio'.
    //* The 'stdio' transport is used for local work (no authentication).
    //* The 'streamable-http' transport is used for HTTP-based communication (OAuth protected).
    TRANSPORT: z.string().default("stdio").optional().transform((val) => {
        if (val?.toLowerCase() === "streamable-http") return "streamable-http";
        return "stdio";
    }),
    //* Public base URL of the server, as seen by MCP clients (used as OAuth issuer).
    //* Example: https://figma-mcp.example.com
    PUBLIC_URL: z.string().optional().transform((val) => (val || "http://localhost:38450").replace(/\/+$/, "")),
    PORT: intFromEnv(38450),
    //* SQLite database file used for users, OAuth clients, tokens and plugin pairings.
    DB_PATH: z.string().optional().transform((val) => val || path.join(process.cwd(), "data", "figma-mcp.db")),
    //* How long a tool call waits for the Figma plugin to answer.
    TASK_TIMEOUT_MS: intFromEnv(30000),
    //* Access token lifetime, in seconds.
    ACCESS_TOKEN_TTL: intFromEnv(3600),
    //* Refresh token lifetime, in seconds.
    REFRESH_TOKEN_TTL: intFromEnv(60 * 60 * 24 * 30),
    //* Comma separated list of origins allowed for browser based MCP clients. Empty = any.
    ALLOWED_ORIGINS: z.string().optional().transform((val) =>
        (val || "").split(",").map((s) => s.trim()).filter(Boolean)
    ),
});

export type EnvStartConfig = z.infer<typeof envStartSchema>;

export const config: EnvStartConfig = envStartSchema.parse(process.env);

export const PORT = config.PORT;

export type Config = EnvStartConfig;
