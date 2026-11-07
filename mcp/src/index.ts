#!/usr/bin/env node
import { config } from "./config.js";
import { startSTDIO } from "./stdio.js";
import { startStreamableHTTP } from "./streamable-http.js";

try {
    if (config.TRANSPORT === "streamable-http") {
        await startStreamableHTTP();
    } else {
        await startSTDIO();
    }
} catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
}
