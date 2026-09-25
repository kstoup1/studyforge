import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encrypts Canvas personal access tokens at rest. A Canvas token acts as the student
 * on their whole Canvas account, so a database leak must not leak usable tokens.
 *
 * AES-256-GCM (authenticated: tampering is detected, not silently decrypted to
 * garbage), a fresh random 12-byte IV per token, and a key derived with HKDF from
 * AUTH_SECRET -- one less secret to configure, and a distinct "info" label means the
 * derived key is never the same bytes Auth.js itself uses. Rotating AUTH_SECRET makes
 * stored tokens undecryptable; users then just reconnect Canvas.
 *
 * Format: "v1." + base64url(iv | authTag | ciphertext). The version prefix leaves room
 * to change the scheme later without guessing what an old value is.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenDecryptionError extends Error {}

function deriveKey(secret: string): Buffer {
  if (!secret) throw new Error("AUTH_SECRET is required to encrypt Canvas tokens");
  return Buffer.from(hkdfSync("sha256", secret, "studyforge", "canvas-token-v1", 32));
}

export function encryptToken(token: string, secret = process.env.AUTH_SECRET ?? ""): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${VERSION}.${packed.toString("base64url")}`;
}

export function decryptToken(stored: string, secret = process.env.AUTH_SECRET ?? ""): string {
  const [version, payload] = stored.split(".");
  if (version !== VERSION || !payload) throw new TokenDecryptionError("Unknown token format");
  const packed = Buffer.from(payload, "base64url");
  if (packed.length <= IV_BYTES + TAG_BYTES) throw new TokenDecryptionError("Token is truncated");
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptionError(
      "Token could not be decrypted (tampered, or AUTH_SECRET changed)",
    );
  }
}
