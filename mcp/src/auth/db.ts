import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { nowSeconds, unrefTimer } from "../utils.js";

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
    if (db) return db;

    fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
    db = new DatabaseSync(config.DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    migrate(db);
    return db;
}

function migrate(database: DatabaseSync) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            disabled      INTEGER NOT NULL DEFAULT 0,
            created_at    INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS oauth_clients (
            client_id  TEXT PRIMARY KEY,
            info_json  TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        -- Authorization requests waiting for the user to log in
        CREATE TABLE IF NOT EXISTS auth_requests (
            id          TEXT PRIMARY KEY,
            client_id   TEXT NOT NULL,
            params_json TEXT NOT NULL,
            expires_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_codes (
            code_hash      TEXT PRIMARY KEY,
            client_id      TEXT NOT NULL,
            user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_challenge TEXT NOT NULL,
            redirect_uri   TEXT NOT NULL,
            scopes         TEXT NOT NULL,
            resource       TEXT,
            expires_at     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tokens (
            token_hash TEXT PRIMARY KEY,
            kind       TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
            client_id  TEXT NOT NULL,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            scopes     TEXT NOT NULL,
            resource   TEXT,
            expires_at INTEGER NOT NULL,
            revoked    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS tokens_user_idx ON tokens(user_id);

        -- A Figma plugin instance paired with a user
        CREATE TABLE IF NOT EXISTS plugin_pairings (
            id         TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL UNIQUE,
            user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_name  TEXT,
            created_at INTEGER NOT NULL,
            last_seen  INTEGER NOT NULL,
            revoked    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS plugin_pairings_user_idx ON plugin_pairings(user_id);
    `);
}

export function purgeExpired() {
    const database = getDb();
    const now = nowSeconds();
    database.prepare("DELETE FROM auth_requests WHERE expires_at < ?").run(now);
    database.prepare("DELETE FROM auth_codes WHERE expires_at < ?").run(now);
    // Revoked tokens are kept until they expire so refresh token reuse can be detected.
    database.prepare("DELETE FROM tokens WHERE expires_at < ?").run(now);
    // Pairings not seen for 90 days are forgotten
    database.prepare("DELETE FROM plugin_pairings WHERE revoked = 1 OR last_seen < ?").run(now - 60 * 60 * 24 * 90);
}

export function startPurgeTimer() {
    purgeExpired();
    const timer = setInterval(() => {
        try {
            purgeExpired();
        } catch (error) {
            console.error("Failed to purge expired auth data:", error);
        }
    }, 10 * 60 * 1000);
    unrefTimer(timer);
}
