/**
 * Unit tests for the vault's authenticated-encryption core
 * (src/dashboard/lib/vault/crypto.ts). The vault stores third-party API
 * keys committed to each repo at `.kody/secrets.enc`, so the crypto here is
 * the only thing standing between a repo read and plaintext secrets — it
 * was previously at ~3% coverage.
 *
 * Covers: round-trip, ciphertext is non-deterministic (random IV),
 * tamper detection (GCM auth tag), payload-format validation, both key
 * encodings (hex + base64), and the missing/invalid-key error paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import { encrypt, decrypt, isVaultConfigured } from "@dashboard/lib/vault/crypto";

const HEX_KEY = randomBytes(32).toString("hex"); // 64 hex chars
const B64_KEY = randomBytes(32).toString("base64"); // 44 base64 chars

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = HEX_KEY;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = savedKey;
});

describe("vault crypto", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const secret = "sk-proj-super-secret-value-123";
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it("round-trips empty strings and unicode", () => {
    expect(decrypt(encrypt(""))).toBe("");
    expect(decrypt(encrypt("café ☕ 你好"))).toBe("café ☕ 你好");
  });

  it("produces a versioned 4-part payload", () => {
    const parts = encrypt("x").split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("is non-deterministic — same plaintext yields different ciphertext", () => {
    // Random IV per call; ciphertexts must differ even for identical input.
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects a tampered ciphertext (GCM auth tag mismatch)", () => {
    const [v, iv, ct, tag] = encrypt("secret").split(":");
    // Flip the ciphertext segment; the auth tag should no longer verify.
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    const tampered = `${v}:${iv}:${flipped.toString("base64")}:${tag}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects a malformed payload format", () => {
    expect(() => decrypt("not-a-valid-payload")).toThrow(/Invalid vault payload/);
    expect(() => decrypt("v1:only:three")).toThrow(/Invalid vault payload/);
  });

  it("rejects an unknown version prefix", () => {
    const [, iv, ct, tag] = encrypt("secret").split(":");
    expect(() => decrypt(`v2:${iv}:${ct}:${tag}`)).toThrow(/Invalid vault payload/);
  });

  it("accepts a base64-encoded 32-byte key", () => {
    process.env.KODY_MASTER_KEY = B64_KEY;
    expect(decrypt(encrypt("via-b64"))).toBe("via-b64");
  });

  it("throws a helpful error when the key is missing", () => {
    delete process.env.KODY_MASTER_KEY;
    expect(() => encrypt("x")).toThrow(/KODY_MASTER_KEY is not configured/);
    expect(isVaultConfigured()).toBe(false);
  });

  it("throws when the key does not decode to 32 bytes", () => {
    process.env.KODY_MASTER_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
    expect(isVaultConfigured()).toBe(false);
  });

  it("reports configured for both valid encodings", () => {
    process.env.KODY_MASTER_KEY = HEX_KEY;
    expect(isVaultConfigured()).toBe(true);
    process.env.KODY_MASTER_KEY = B64_KEY;
    expect(isVaultConfigured()).toBe(true);
  });
});
