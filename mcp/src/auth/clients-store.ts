import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { getDb } from "./db.js";
import { generateUUID, nowSeconds } from "../utils.js";

// Persists OAuth clients created through dynamic client registration (RFC 7591).
export class SqliteClientsStore implements OAuthRegisteredClientsStore {
    getClient(clientId: string): OAuthClientInformationFull | undefined {
        const row = getDb()
            .prepare("SELECT info_json FROM oauth_clients WHERE client_id = ?")
            .get(clientId) as { info_json: string } | undefined;
        return row ? (JSON.parse(row.info_json) as OAuthClientInformationFull) : undefined;
    }

    registerClient(
        client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">
    ): OAuthClientInformationFull {
        // The SDK normally generates client_id already; keep a fallback just in case.
        const full = {
            client_id: generateUUID(),
            client_id_issued_at: nowSeconds(),
            ...client,
        } as OAuthClientInformationFull;
        getDb()
            .prepare("INSERT INTO oauth_clients (client_id, info_json, created_at) VALUES (?, ?, ?)")
            .run(full.client_id, JSON.stringify(full), nowSeconds());
        return full;
    }
}
