import crypto from "node:crypto";

export function generateUUID(): string {
    return crypto.randomUUID();
}

// Opaque, URL-safe random secret (tokens, authorization codes, request ids).
export function randomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
}

export function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Figma plugin typings (typeRoots) declare timers as numbers; at runtime they are Node Timeout objects.
export function unrefTimer(timer: unknown): void {
    (timer as { unref?: () => void } | undefined)?.unref?.();
}
