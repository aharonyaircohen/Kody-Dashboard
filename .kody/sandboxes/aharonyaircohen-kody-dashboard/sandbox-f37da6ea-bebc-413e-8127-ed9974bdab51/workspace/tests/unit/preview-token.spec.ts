/**
 * Unit tests for the preview session token
 * (src/dashboard/lib/preview-token.ts) that gate access to per-PR Fly preview
 * machines. The doorman in each preview machine verifies these tickets — a
 * forgery or a constant-time-compare regression here would expose previews to
 * any holder of a fly.dev URL, so the verify path is security-load-bearing.
 *
 * Covers: key derivation, mint determinism, round-trip verify, expiry
 * rejection, signature tamper rejection, key mismatch (different repo/pr),
 * master-key rotation, and the missing-key error path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  derivePreviewKey,
  mintPreviewTicket,
  verifyPreviewTicket,
} from "@dashboard/lib/preview-token";

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = "test-master-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = savedKey;
});

describe("preview ticket", () => {
  describe("derivePreviewKey", () => {
    it("derives a 32-byte buffer", () => {
      const key = derivePreviewKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.byteLength).toBe(32);
    });

    it("is deterministic for the same master key", () => {
      const a = derivePreviewKey();
      const b = derivePreviewKey();
      expect(a.equals(b)).toBe(true);
    });

    it("produces different keys for different master keys", () => {
      const a = derivePreviewKey();
      process.env.KODY_MASTER_KEY = "rotated-master-key-bbbbbbbbbbbbbbbbbbbb";
      const b = derivePreviewKey();
      expect(a.equals(b)).toBe(false);
    });

    it("throws when the master key is missing", () => {
      delete process.env.KODY_MASTER_KEY;
      expect(() => derivePreviewKey()).toThrow(
        /KODY_MASTER_KEY is not configured/,
      );
    });
  });

  describe("mintPreviewTicket", () => {
    it("returns a non-empty ticket and a future expiresAt", () => {
      const { ticket, expiresAt } = mintPreviewTicket("owner/repo", 42, 3600);
      expect(typeof ticket).toBe("string");
      expect(ticket.length).toBeGreaterThan(0);
      expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("ticket is base64url decodable", () => {
      const { ticket } = mintPreviewTicket("owner/repo", 42, 3600);
      // Must not throw
      const decoded = JSON.parse(
        Buffer.from(ticket, "base64url").toString("utf8"),
      );
      expect(decoded).toMatchObject({
        r: "owner/repo",
        p: 42,
        s: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
    });

    it("expiry is approximately now + ttlSec", () => {
      const ttl = 7200;
      const before = Math.floor(Date.now() / 1000);
      const { expiresAt } = mintPreviewTicket("owner/repo", 42, ttl);
      const after = Math.floor(Date.now() / 1000);
      expect(expiresAt).toBeGreaterThanOrEqual(before + ttl);
      expect(expiresAt).toBeLessThanOrEqual(after + ttl);
    });

    it("throws when the master key is missing", () => {
      delete process.env.KODY_MASTER_KEY;
      expect(() => mintPreviewTicket("owner/repo", 42, 3600)).toThrow(
        /KODY_MASTER_KEY is not configured/,
      );
    });
  });

  describe("verifyPreviewTicket", () => {
    it("verifies a freshly minted ticket", () => {
      const { ticket, expiresAt } = mintPreviewTicket("owner/repo", 42, 3600);
      const result = verifyPreviewTicket(ticket, "owner/repo", 42);
      expect(result).toBe(true);
    });

    it("rejects a ticket for a different repo", () => {
      const { ticket } = mintPreviewTicket("owner/repo", 42, 3600);
      expect(verifyPreviewTicket(ticket, "other/repo", 42)).toBe(false);
    });

    it("rejects a ticket for a different PR", () => {
      const { ticket } = mintPreviewTicket("owner/repo", 42, 3600);
      expect(verifyPreviewTicket(ticket, "owner/repo", 99)).toBe(false);
    });

    it("rejects a tampered / garbage ticket", () => {
      expect(
        verifyPreviewTicket("not-valid-base64url!!!", "owner/repo", 42),
      ).toBe(false);
      expect(verifyPreviewTicket("", "owner/repo", 42)).toBe(false);
      // Valid base64url but not a JSON object
      expect(verifyPreviewTicket("aW52YWxpZA==", "owner/repo", 42)).toBe(false);
    });

    it("rejects a ticket with a wrong-length sig", () => {
      const badPayload = Buffer.from(
        JSON.stringify({
          r: "owner/repo",
          p: 42,
          e: 9999999999,
          s: "deadbeef",
        }),
      ).toString("base64url");
      expect(verifyPreviewTicket(badPayload, "owner/repo", 42)).toBe(false);
    });

    it("rejects an expired ticket", () => {
      // Mint with TTL=0 should expire immediately
      const { ticket } = mintPreviewTicket("owner/repo", 42, 0);
      const result = verifyPreviewTicket(ticket, "owner/repo", 42);
      expect(result).toBe(false);
    });

    it("rejects a ticket from a different master key (rotation)", () => {
      const { ticket } = mintPreviewTicket("owner/repo", 42, 3600);
      process.env.KODY_MASTER_KEY = "rotated-master-key-bbbbbbbbbbbbbbbbbbbb";
      expect(verifyPreviewTicket(ticket, "owner/repo", 42)).toBe(false);
    });

    it("throws nothing on any invalid input (returns false)", () => {
      expect(verifyPreviewTicket("deadbeef", "owner/repo", 42)).toBe(false);
      expect(
        verifyPreviewTicket(
          Buffer.from(
            JSON.stringify({ r: 123, p: "bad", e: null, s: [] }),
          ).toString("base64url"),
          "owner/repo",
          42,
        ),
      ).toBe(false);
    });
  });
});
