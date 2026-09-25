import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, TokenDecryptionError } from "./token-crypto";

const SECRET = "test-secret-at-least-somewhat-long";
const TOKEN = "7~AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

describe("Canvas token encryption", () => {
  it("round-trips a token", () => {
    expect(decryptToken(encryptToken(TOKEN, SECRET), SECRET)).toBe(TOKEN);
  });

  it("never stores the token in plaintext and uses a fresh IV each time", () => {
    const a = encryptToken(TOKEN, SECRET);
    const b = encryptToken(TOKEN, SECRET);
    expect(a).not.toContain(TOKEN);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
  });

  it("detects tampering instead of returning garbage", () => {
    const stored = encryptToken(TOKEN, SECRET);
    const payload = Buffer.from(stored.slice(3), "base64url");
    payload[payload.length - 1] ^= 0xff; // flip bits in the ciphertext
    const tampered = `v1.${payload.toString("base64url")}`;
    expect(() => decryptToken(tampered, SECRET)).toThrow(TokenDecryptionError);
  });

  it("fails cleanly with the wrong secret (e.g. AUTH_SECRET rotated)", () => {
    const stored = encryptToken(TOKEN, SECRET);
    expect(() => decryptToken(stored, "a-different-secret")).toThrow(TokenDecryptionError);
  });

  it("rejects malformed values", () => {
    expect(() => decryptToken("plaintext-token", SECRET)).toThrow(TokenDecryptionError);
    expect(() => decryptToken("v1.", SECRET)).toThrow(TokenDecryptionError);
    expect(() => decryptToken("v1.AAAA", SECRET)).toThrow(TokenDecryptionError);
  });

  it("refuses to run without a secret", () => {
    expect(() => encryptToken(TOKEN, "")).toThrow();
  });
});
