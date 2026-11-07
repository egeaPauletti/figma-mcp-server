import { getDb } from "./db.js";
import { hashPassword, verifyPassword, getDummyHash } from "./passwords.js";
import { generateUUID, nowSeconds } from "../utils.js";

export interface User {
    id: string;
    email: string;
    disabled: boolean;
    createdAt: number;
}

interface UserRow {
    id: string;
    email: string;
    password_hash: string;
    disabled: number;
    created_at: number;
}

function toUser(row: UserRow): User {
    return { id: row.id, email: row.email, disabled: row.disabled === 1, createdAt: row.created_at };
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export async function createUser(email: string, password: string): Promise<User> {
    const id = generateUUID();
    const passwordHash = await hashPassword(password);
    getDb()
        .prepare("INSERT INTO users (id, email, password_hash, disabled, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(id, normalizeEmail(email), passwordHash, nowSeconds());
    return getUserById(id)!;
}

export function getUserById(id: string): User | undefined {
    const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? toUser(row) : undefined;
}

export function getUserByEmail(email: string): User | undefined {
    const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined;
    return row ? toUser(row) : undefined;
}

export function listUsers(): User[] {
    const rows = getDb().prepare("SELECT * FROM users ORDER BY created_at").all() as unknown as UserRow[];
    return rows.map(toUser);
}

export async function setPassword(userId: string, password: string): Promise<void> {
    getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), userId);
}

export function setDisabled(userId: string, disabled: boolean): void {
    getDb().prepare("UPDATE users SET disabled = ? WHERE id = ?").run(disabled ? 1 : 0, userId);
}

export function deleteUser(userId: string): void {
    getDb().prepare("DELETE FROM users WHERE id = ?").run(userId);
}

// Returns the user only when the credentials are valid and the account is enabled.
export async function authenticate(email: string, password: string): Promise<User | undefined> {
    const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normalizeEmail(email)) as UserRow | undefined;
    if (!row) {
        await verifyPassword(password, await getDummyHash());
        return undefined;
    }
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok || row.disabled === 1) return undefined;
    return toUser(row);
}

export function revokeUserTokens(userId: string): void {
    const db = getDb();
    db.prepare("UPDATE tokens SET revoked = 1 WHERE user_id = ?").run(userId);
    db.prepare("UPDATE plugin_pairings SET revoked = 1 WHERE user_id = ?").run(userId);
}
