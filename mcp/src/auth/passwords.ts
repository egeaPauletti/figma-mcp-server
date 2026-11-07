import crypto from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (err, key) => {
            if (err) reject(err);
            else resolve(key);
        });
    });
}

// Format: scrypt$<salt base64>$<hash base64>
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt);
    return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, "base64");
    const actual = await scrypt(password, Buffer.from(saltB64, "base64"));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// Used to keep login timing similar when the user does not exist.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
    return dummyHash;
}
