/**
 * Unit tests for the webhook source-IP verifier
 * (src/dashboard/lib/webhooks/github-ip.ts). This is the ONLY authentication
 * on /api/webhooks/github and /api/kody/events/ingest — there is no shared
 * secret, so a CIDR-match bug either drops every real GitHub delivery (the
 * dashboard silently goes back to stale polling) or accepts spoofed POSTs.
 * Was at 0% coverage.
 *
 * The CIDR list is fetched from GitHub's /meta and cached at module scope,
 * so each test re-imports the module with its own stubbed `fetch` to start
 * from a cold cache.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const META = {
  hooks: [
    "192.30.252.0/22",
    "185.199.108.0/22",
    "140.82.112.0/20", // 140.82.112.0 – 140.82.127.255
    "2606:50c0::/32",
  ],
  actions: ["13.64.0.0/16"],
};

type Meta = { hooks?: string[]; actions?: string[] };

async function load(
  meta: Meta = META,
  opts: { ok?: boolean; reject?: boolean } = {},
) {
  vi.resetModules();
  const fetchMock = opts.reject
    ? vi.fn().mockRejectedValue(new Error("network down"))
    : vi.fn().mockResolvedValue({
        ok: opts.ok ?? true,
        status: opts.ok === false ? 500 : 200,
        json: async () => meta,
      });
  vi.stubGlobal("fetch", fetchMock);
  const mod = await import("@dashboard/lib/webhooks/github-ip");
  return { mod, fetchMock };
}

afterEach(() => vi.unstubAllGlobals());

describe("getClientIp", () => {
  it("takes the first entry of x-forwarded-for", async () => {
    const { mod } = await load();
    const h = new Headers({ "x-forwarded-for": "140.82.115.42, 10.0.0.1" });
    expect(mod.getClientIp(h)).toBe("140.82.115.42");
  });

  it("falls back to x-real-ip when no forwarded-for", async () => {
    const { mod } = await load();
    expect(mod.getClientIp(new Headers({ "x-real-ip": "1.2.3.4" }))).toBe(
      "1.2.3.4",
    );
  });

  it("returns null when neither header is present", async () => {
    const { mod } = await load();
    expect(mod.getClientIp(new Headers())).toBeNull();
  });
});

describe("isFromGitHub — IPv4 matching", () => {
  it("accepts an IP inside a hooks CIDR range", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub("140.82.115.42")).toBe(true);
    expect(await mod.isFromGitHub("192.30.252.1")).toBe(true);
  });

  it("matches the boundary addresses of a /20 and rejects just outside", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub("140.82.112.0")).toBe(true);
    expect(await mod.isFromGitHub("140.82.127.255")).toBe(true);
    expect(await mod.isFromGitHub("140.82.128.0")).toBe(false); // one past the block
  });

  it("rejects a non-GitHub IP", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub("8.8.8.8")).toBe(false);
  });

  it("strips an IPv4-mapped IPv6 prefix before matching", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub("::ffff:140.82.115.42")).toBe(true);
  });

  it("honors /0 (match all) and /32 (exact) masks", async () => {
    const all = await load({ hooks: ["0.0.0.0/0"] });
    expect(await all.mod.isFromGitHub("203.0.113.7")).toBe(true);

    const exact = await load({ hooks: ["1.2.3.4/32"] });
    expect(await exact.mod.isFromGitHub("1.2.3.4")).toBe(true);
    expect(await exact.mod.isFromGitHub("1.2.3.5")).toBe(false);
  });
});

describe("isFromGitHub — IPv6 + bad input", () => {
  it("matches an IPv6 address inside the hooks range", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub("2606:50c0::1")).toBe(true);
    expect(await mod.isFromGitHub("2607:f8b0::1")).toBe(false);
  });

  it("returns false for null / empty / garbage input", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHub(null)).toBe(false);
    expect(await mod.isFromGitHub(undefined)).toBe(false);
    expect(await mod.isFromGitHub("")).toBe(false);
    expect(await mod.isFromGitHub("not-an-ip")).toBe(false);
  });
});

describe("isFromGitHub — field isolation + resilience", () => {
  it("uses the hooks field, not actions — an Actions runner IP is not a webhook IP", async () => {
    const { mod } = await load();
    expect(await mod.isFromGitHubActions("13.64.1.1")).toBe(true);
    expect(await mod.isFromGitHub("13.64.1.1")).toBe(false);
  });

  it("caches the CIDR list — repeated checks fetch /meta only once", async () => {
    const { mod, fetchMock } = await load();
    await mod.isFromGitHub("140.82.115.42");
    await mod.isFromGitHub("192.30.252.9");
    await mod.isFromGitHub("8.8.8.8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed (returns false) when /meta is unreachable", async () => {
    const { mod } = await load(META, { reject: true });
    expect(await mod.isFromGitHub("140.82.115.42")).toBe(false);
  });

  it("fails closed when /meta returns a non-2xx", async () => {
    const { mod } = await load(META, { ok: false });
    expect(await mod.isFromGitHub("140.82.115.42")).toBe(false);
  });
});
