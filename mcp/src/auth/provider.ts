import type { Response } from "express";
import type { AuthorizationParams, OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
    OAuthClientInformationFull,
    OAuthTokenRevocationRequest,
    OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
    InvalidGrantError,
    InvalidScopeError,
    InvalidTargetError,
    InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { SqliteClientsStore } from "./clients-store.js";
import { getDb } from "./db.js";
import { getUserById, type User } from "./users.js";
import { renderLoginPage } from "./login-page.js";
import { config } from "../config.js";
import { nowSeconds, randomToken, sha256 } from "../utils.js";

export const SUPPORTED_SCOPES = ["figma"];
const AUTH_REQUEST_TTL = 10 * 60;
const AUTH_CODE_TTL = 5 * 60;

export interface PendingAuthorization {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
    state?: string | undefined;
    resource?: string | undefined;
}

interface TokenRow {
    token_hash: string;
    kind: "access" | "refresh";
    client_id: string;
    user_id: string;
    scopes: string;
    resource: string | null;
    expires_at: number;
    revoked: number;
}

interface CodeRow {
    code_hash: string;
    client_id: string;
    user_id: string;
    code_challenge: string;
    redirect_uri: string;
    scopes: string;
    resource: string | null;
    expires_at: number;
}

export function getMcpResourceUrl(): URL {
    return new URL(`${config.PUBLIC_URL}/mcp`);
}

export class FigmaOAuthProvider implements OAuthServerProvider {
    private readonly _clientsStore = new SqliteClientsStore();

    get clientsStore() {
        return this._clientsStore;
    }

    // Step 1: store the request and show the login form. The form is handled by login-route.ts.
    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
        const scopes = this.resolveScopes(params.scopes);
        const resource = this.validateResource(params.resource);

        const requestId = randomToken();
        const pending: PendingAuthorization = {
            clientId: client.client_id,
            redirectUri: params.redirectUri,
            codeChallenge: params.codeChallenge,
            scopes,
            state: params.state,
            resource,
        };
        getDb()
            .prepare("INSERT INTO auth_requests (id, client_id, params_json, expires_at) VALUES (?, ?, ?, ?)")
            .run(requestId, client.client_id, JSON.stringify(pending), nowSeconds() + AUTH_REQUEST_TTL);

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
        res.status(200).send(renderLoginPage({ requestId, clientName: client.client_name }));
    }

    // Step 2 (called by login-route after a successful login): consume the request and build the redirect.
    consumePendingAuthorization(requestId: string): PendingAuthorization | undefined {
        const db = getDb();
        const row = db
            .prepare("SELECT params_json, expires_at FROM auth_requests WHERE id = ?")
            .get(requestId) as { params_json: string; expires_at: number } | undefined;
        if (!row) return undefined;
        db.prepare("DELETE FROM auth_requests WHERE id = ?").run(requestId);
        if (row.expires_at < nowSeconds()) return undefined;
        return JSON.parse(row.params_json) as PendingAuthorization;
    }

    peekPendingAuthorization(requestId: string): PendingAuthorization | undefined {
        const row = getDb()
            .prepare("SELECT params_json, expires_at FROM auth_requests WHERE id = ?")
            .get(requestId) as { params_json: string; expires_at: number } | undefined;
        if (!row || row.expires_at < nowSeconds()) return undefined;
        return JSON.parse(row.params_json) as PendingAuthorization;
    }

    issueAuthorizationCode(pending: PendingAuthorization, user: User): string {
        const code = randomToken();
        getDb()
            .prepare(`INSERT INTO auth_codes
                (code_hash, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
                sha256(code),
                pending.clientId,
                user.id,
                pending.codeChallenge,
                pending.redirectUri,
                pending.scopes.join(" "),
                pending.resource ?? null,
                nowSeconds() + AUTH_CODE_TTL
            );
        return code;
    }

    async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
        return this.getCode(client, authorizationCode).code_challenge;
    }

    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        _codeVerifier?: string,
        redirectUri?: string,
        resource?: URL
    ): Promise<OAuthTokens> {
        const row = this.getCode(client, authorizationCode);
        // Authorization codes are single use
        getDb().prepare("DELETE FROM auth_codes WHERE code_hash = ?").run(row.code_hash);

        if (redirectUri !== undefined && redirectUri !== row.redirect_uri) {
            throw new InvalidGrantError("redirect_uri does not match the authorization request");
        }
        if (resource && row.resource && resource.href !== row.resource) {
            throw new InvalidTargetError("resource does not match the authorization request");
        }
        this.requireActiveUser(row.user_id, InvalidGrantError);

        return this.issueTokens(client.client_id, row.user_id, row.scopes.split(" ").filter(Boolean), row.resource);
    }

    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string,
        scopes?: string[],
        resource?: URL
    ): Promise<OAuthTokens> {
        const db = getDb();
        const row = db
            .prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'refresh'")
            .get(sha256(refreshToken)) as TokenRow | undefined;

        if (!row || row.client_id !== client.client_id) {
            throw new InvalidGrantError("Invalid refresh token");
        }
        if (row.revoked === 1) {
            // A rotated refresh token was used again: assume it leaked and revoke the whole grant.
            db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ? AND client_id = ?").run(row.user_id, row.client_id);
            throw new InvalidGrantError("Refresh token was already used");
        }
        if (row.expires_at < nowSeconds()) {
            throw new InvalidGrantError("Refresh token expired");
        }
        if (resource && row.resource && resource.href !== row.resource) {
            throw new InvalidTargetError("resource does not match the original grant");
        }
        this.requireActiveUser(row.user_id, InvalidGrantError);

        const granted = row.scopes.split(" ").filter(Boolean);
        let nextScopes = granted;
        if (scopes && scopes.length > 0) {
            if (!scopes.every((s) => granted.includes(s))) {
                throw new InvalidScopeError("Requested scopes exceed the original grant");
            }
            nextScopes = scopes;
        }

        // Rotation: the old refresh token can no longer be used
        db.prepare("UPDATE tokens SET revoked = 1 WHERE token_hash = ?").run(row.token_hash);
        return this.issueTokens(client.client_id, row.user_id, nextScopes, row.resource);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const row = getDb()
            .prepare("SELECT * FROM tokens WHERE token_hash = ? AND kind = 'access'")
            .get(sha256(token)) as TokenRow | undefined;

        if (!row || row.revoked === 1) throw new InvalidTokenError("Invalid access token");
        if (row.expires_at < nowSeconds()) throw new InvalidTokenError("Access token expired");
        const user = this.requireActiveUser(row.user_id, InvalidTokenError);

        const info: AuthInfo = {
            token,
            clientId: row.client_id,
            scopes: row.scopes.split(" ").filter(Boolean),
            expiresAt: row.expires_at,
            extra: { userId: user.id, email: user.email },
        };
        if (row.resource) info.resource = new URL(row.resource);
        return info;
    }

    async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
        getDb()
            .prepare("UPDATE tokens SET revoked = 1 WHERE token_hash = ? AND client_id = ?")
            .run(sha256(request.token), client.client_id);
    }

    // Helpers

    private getCode(client: OAuthClientInformationFull, authorizationCode: string): CodeRow {
        const row = getDb()
            .prepare("SELECT * FROM auth_codes WHERE code_hash = ?")
            .get(sha256(authorizationCode)) as CodeRow | undefined;
        if (!row || row.client_id !== client.client_id || row.expires_at < nowSeconds()) {
            throw new InvalidGrantError("Invalid or expired authorization code");
        }
        return row;
    }

    private issueTokens(clientId: string, userId: string, scopes: string[], resource: string | null): OAuthTokens {
        const db = getDb();
        const now = nowSeconds();
        const accessToken = `fma_${randomToken()}`;
        const refreshToken = `fmr_${randomToken()}`;
        const insert = db.prepare(`INSERT INTO tokens
            (token_hash, kind, client_id, user_id, scopes, resource, expires_at, revoked)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)`);
        insert.run(sha256(accessToken), "access", clientId, userId, scopes.join(" "), resource, now + config.ACCESS_TOKEN_TTL);
        insert.run(sha256(refreshToken), "refresh", clientId, userId, scopes.join(" "), resource, now + config.REFRESH_TOKEN_TTL);

        return {
            access_token: accessToken,
            token_type: "bearer",
            expires_in: config.ACCESS_TOKEN_TTL,
            refresh_token: refreshToken,
            scope: scopes.join(" "),
        };
    }

    private requireActiveUser(userId: string, ErrorType: new (message: string) => Error): User {
        const user = getUserById(userId);
        if (!user || user.disabled) throw new ErrorType("User is disabled or no longer exists");
        return user;
    }

    private resolveScopes(requested: string[] | undefined): string[] {
        if (!requested || requested.length === 0) return [...SUPPORTED_SCOPES];
        const unknown = requested.filter((s) => !SUPPORTED_SCOPES.includes(s));
        if (unknown.length > 0) throw new InvalidScopeError(`Unsupported scope: ${unknown.join(" ")}`);
        return requested;
    }

    private validateResource(resource: URL | undefined): string | undefined {
        if (!resource) return undefined;
        const expected = getMcpResourceUrl();
        if (resource.origin !== expected.origin) {
            throw new InvalidTargetError(`Unknown resource: ${resource.href}`);
        }
        return resource.href;
    }
}
