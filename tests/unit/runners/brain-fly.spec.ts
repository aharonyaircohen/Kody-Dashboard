/**
 * brain-fly module tests. Exercises the per-user provisioner against a
 * mocked Fly Machines API.
 *
 * The Fly API is mocked via globalThis.fetch — we don't hit the network.
 * Each test installs its own fetch stub that records request paths and
 * returns canned JSON. The shape of those responses mirrors the actual
 * Fly Machines API (apps.machines.dev/v1).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allocateIpsIfMissing,
  brainAppName,
  brainStatus,
  DEFAULT_IMAGE,
  destroyBrain,
  flyFetch,
  provisionBrain,
  sameImageRepoTag,
} from "@dashboard/lib/runners/brain-fly";

const TOKEN = "fly-test-token";

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function installFetchStub(
  handler: (call: RecordedCall) => { status?: number; json?: unknown },
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body =
        typeof init?.body === "string" && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        for (const k of Object.keys(h)) headers[k.toLowerCase()] = h[k]!;
      }
      const call: RecordedCall = { url, method, body, headers };
      calls.push(call);

      // Default IP-allocation handling. The provisioner now calls
      // `GET /apps/<name>/ips` to decide whether IPs are missing, and if
      // empty, posts to api.fly.io/graphql to allocate them. Provision
      // tests don't care about this side-flow, so we pre-stub it to
      // "already has IPs" — no graphql calls happen and the test handler
      // doesn't need to know about the endpoint.
      if (call.method === "GET" && /\/apps\/[^/]+\/ips$/.test(call.url)) {
        return new Response(
          JSON.stringify([{ id: "ip-1", address: "1.2.3.4" }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (call.url === "https://api.fly.io/graphql") {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      const r = handler(call);
      const status = r.status ?? 200;
      return new Response(
        r.json !== undefined ? JSON.stringify(r.json) : null,
        {
          status,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ────────────────────────────────────────────────────────────────────────────
// brainAppName: deterministic, Fly-name-safe
// ────────────────────────────────────────────────────────────────────────────

describe("brainAppName", () => {
  it("lowercases and prefixes with kody-brain-", () => {
    expect(brainAppName("AguyAharon")).toBe("kody-brain-aguyaharon");
  });

  it("replaces non-alphanumerics with single hyphens", () => {
    expect(brainAppName("user.name_with-stuff")).toBe(
      "kody-brain-user-name-with-stuff",
    );
  });

  it("strips leading and trailing hyphens from the slug", () => {
    expect(brainAppName("--weird--")).toBe("kody-brain-weird");
  });

  it("throws on an effectively empty account", () => {
    expect(() => brainAppName("!!!")).toThrow(/account is empty/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// flyFetch: low-level error/404 handling
// ────────────────────────────────────────────────────────────────────────────

describe("flyFetch", () => {
  it("returns null on 404 when allow404 is set", async () => {
    installFetchStub(() => ({ status: 404, json: { error: "not found" } }));
    const out = await flyFetch<unknown>("/apps/foo", {
      token: TOKEN,
      allow404: true,
    });
    expect(out).toBeNull();
  });

  it("throws on 404 when allow404 is unset", async () => {
    installFetchStub(() => ({ status: 404, json: { error: "not found" } }));
    await expect(flyFetch("/apps/foo", { token: TOKEN })).rejects.toThrow(
      /404/,
    );
  });

  it("throws on 5xx with status code in the message", async () => {
    installFetchStub(() => ({
      status: 503,
      json: { error: "service unavailable" },
    }));
    await expect(flyFetch("/apps/foo", { token: TOKEN })).rejects.toThrow(
      /503/,
    );
  });

  it("sends Bearer auth and JSON content type", async () => {
    const calls = installFetchStub(() => ({ json: { ok: true } }));
    await flyFetch("/apps/foo", { token: TOKEN });
    expect(calls[0]!.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("serializes the body and forwards the method", async () => {
    const calls = installFetchStub(() => ({ json: { id: "m1" } }));
    await flyFetch("/apps/foo/machines", {
      method: "POST",
      token: TOKEN,
      body: { name: "m", region: "fra" },
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ name: "m", region: "fra" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// provisionBrain: app + machine creation, idempotency, env wiring
// ────────────────────────────────────────────────────────────────────────────

describe("provisionBrain", () => {
  it("creates the app and machine when neither exists", async () => {
    const calls = installFetchStub((call) => {
      if (
        call.url.endsWith("/apps/kody-brain-alice") &&
        call.method === "GET"
      ) {
        return { status: 404 };
      }
      if (call.url.endsWith("/apps") && call.method === "POST") {
        return { json: { name: "kody-brain-alice" } };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "GET"
      ) {
        return { status: 404 };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "POST"
      ) {
        return { json: { id: "m123", state: "starting", region: "fra" } };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "alice/repo",
      githubToken: "gh-pat",
      apiKeyOverride: "static-key-for-test",
    });

    expect(out).toEqual({
      app: "kody-brain-alice",
      url: "https://kody-brain-alice.fly.dev",
      apiKey: "static-key-for-test",
      machineId: "m123",
      region: "fra",
    });

    const machineCreate = calls.find(
      (c) =>
        c.method === "POST" &&
        c.url.endsWith("/apps/kody-brain-alice/machines"),
    )!;
    const cfg = (
      machineCreate.body as { config: { env: Record<string, string> } }
    ).config;
    expect(cfg.env.REPO).toBe("alice/repo");
    expect(cfg.env.GITHUB_TOKEN).toBe("gh-pat");
    expect(cfg.env.BRAIN_API_KEY).toBe("static-key-for-test");
    expect(cfg.env.PORT).toBe("8080");
  });

  it("reuses an existing live machine and returns its api key (idempotency)", async () => {
    installFetchStub((call) => {
      if (
        call.url.endsWith("/apps/kody-brain-alice") &&
        call.method === "GET"
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "GET"
      ) {
        return {
          json: [
            {
              id: "m-existing",
              state: "started",
              region: "fra",
              config: { env: { BRAIN_API_KEY: "preexisting-key" } },
            },
          ],
        };
      }
      if (call.method === "POST") {
        throw new Error(`should not create anything on reuse: ${call.url}`);
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "alice/repo",
      githubToken: "gh-pat",
    });
    expect(out.apiKey).toBe("preexisting-key");
    expect(out.machineId).toBe("m-existing");
  });

  it("throws when an existing machine has no BRAIN_API_KEY (corrupted state)", async () => {
    installFetchStub((call) => {
      if (
        call.url.endsWith("/apps/kody-brain-alice") &&
        call.method === "GET"
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "GET"
      ) {
        return {
          json: [{ id: "m-bad", state: "started", config: { env: {} } }],
        };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await expect(
      provisionBrain({
        flyToken: TOKEN,
        account: "alice",
        repo: "alice/repo",
        githubToken: "gh-pat",
      }),
    ).rejects.toThrow(/destroy first/);
  });

  it("skips destroyed machines and creates a fresh one when only tombstones exist", async () => {
    installFetchStub((call) => {
      if (
        call.url.endsWith("/apps/kody-brain-alice") &&
        call.method === "GET"
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "GET"
      ) {
        return { json: [{ id: "m-old", state: "destroyed" }] };
      }
      if (
        call.url.endsWith("/apps/kody-brain-alice/machines") &&
        call.method === "POST"
      ) {
        return { json: { id: "m-new", state: "starting", region: "fra" } };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });

    const out = await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "alice/repo",
      githubToken: "gh-pat",
      apiKeyOverride: "k",
    });
    expect(out.machineId).toBe("m-new");
  });

  it("rejects when flyToken is empty", async () => {
    await expect(
      provisionBrain({
        flyToken: "   ",
        account: "alice",
        repo: "alice/repo",
        githubToken: "gh",
      }),
    ).rejects.toThrow(/flyToken required/);
  });

  it("passes the perf tier through to the Fly guest shape", async () => {
    const calls = installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines")) {
        return { json: [] };
      }
      if (call.method === "POST" && call.url.endsWith("/machines")) {
        return { json: { id: "m", state: "starting", region: "fra" } };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "a/r",
      githubToken: "gh",
      perfTier: "high",
      apiKeyOverride: "k",
    });
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/machines"),
    )!;
    const guest = (
      create.body as { config: { guest: { cpus: number; memory_mb: number } } }
    ).config.guest;
    expect(guest.cpus).toBe(2);
    expect(guest.memory_mb).toBe(4096);
  });

  it("stringifies allSecrets into ALL_SECRETS env", async () => {
    const calls = installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { status: 404 };
      }
      if (call.method === "POST" && call.url.endsWith("/apps")) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines"))
        return { json: [] };
      if (call.method === "POST" && call.url.endsWith("/machines")) {
        return { json: { id: "m", state: "starting" } };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "a/r",
      githubToken: "gh",
      allSecrets: { ANTHROPIC_API_KEY: "sk-test", OPENAI_API_KEY: "sk-2" },
      apiKeyOverride: "k",
    });
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/machines"),
    )!;
    const env = (create.body as { config: { env: Record<string, string> } })
      .config.env;
    expect(JSON.parse(env.ALL_SECRETS!)).toEqual({
      ANTHROPIC_API_KEY: "sk-test",
      OPENAI_API_KEY: "sk-2",
    });
  });

  it("exposes :443 and :8080 with autostop=suspend in the machine config", async () => {
    const calls = installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines"))
        return { json: [] };
      if (call.method === "POST" && call.url.endsWith("/machines")) {
        return { json: { id: "m", state: "starting" } };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      repo: "a/r",
      githubToken: "gh",
      apiKeyOverride: "k",
    });
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/machines"),
    )!;
    const cfg = (
      create.body as {
        config: {
          services: Array<{
            ports: Array<{ port: number }>;
            internal_port: number;
            autostop: string;
            autostart: boolean;
          }>;
        };
      }
    ).config;
    const svc = cfg.services[0]!;
    expect(svc.internal_port).toBe(8080);
    expect(svc.autostop).toBe("suspend");
    expect(svc.autostart).toBe(true);
    const portNums = svc.ports.map((p) => p.port).sort((a, b) => a - b);
    expect(portNums).toEqual([80, 443]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sameImageRepoTag: digest-insensitive image comparison
// ────────────────────────────────────────────────────────────────────────────

describe("sameImageRepoTag", () => {
  it("matches identical repo:tag refs", () => {
    expect(
      sameImageRepoTag(
        "ghcr.io/o/kody-brain:latest",
        "ghcr.io/o/kody-brain:latest",
      ),
    ).toBe(true);
  });

  it("ignores the @sha256 digest Fly appends to a resolved tag", () => {
    expect(
      sameImageRepoTag(
        "ghcr.io/o/kody-brain:latest@sha256:abc123",
        "ghcr.io/o/kody-brain:latest",
      ),
    ).toBe(true);
  });

  it("detects a genuine registry change (fly → ghcr)", () => {
    expect(
      sameImageRepoTag(
        "registry.fly.io/kody-brain:latest@sha256:old",
        "ghcr.io/o/kody-brain:latest",
      ),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// provisionBrain: image-ref healing (the registry.fly.io → GHCR migration bug)
// ────────────────────────────────────────────────────────────────────────────

describe("provisionBrain image-ref healing", () => {
  it("creates new machines on the public GHCR DEFAULT_IMAGE", async () => {
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith("/apps/kody-brain-alice"))
        return { json: { name: "kody-brain-alice" } };
      if (call.method === "GET" && call.url.endsWith("/machines"))
        return { json: [] };
      if (call.method === "POST" && call.url.endsWith("/machines"))
        return { json: { id: "m", state: "starting", region: "fra" } };
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      githubToken: "gh",
      apiKeyOverride: "k",
    });
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/machines"),
    )!;
    const image = (create.body as { config: { image: string } }).config.image;
    expect(image).toBe(DEFAULT_IMAGE);
    expect(image.startsWith("ghcr.io/")).toBe(true);
  });

  it("recreates a machine pinned to the stale registry.fly.io image", async () => {
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith("/apps/kody-brain-alice"))
        return { json: { name: "kody-brain-alice" } };
      if (call.method === "GET" && call.url.endsWith("/machines"))
        return {
          json: [
            {
              id: "m-stale",
              state: "suspended",
              region: "fra",
              config: {
                image: "registry.fly.io/kody-brain:latest@sha256:dead",
                env: { BRAIN_API_KEY: "old-key" },
              },
            },
          ],
        };
      if (call.method === "DELETE" && call.url.includes("/machines/m-stale"))
        return { status: 200, json: { ok: true } };
      if (call.method === "POST" && call.url.endsWith("/machines"))
        return { json: { id: "m-fresh", state: "starting", region: "fra" } };
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });

    const out = await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      githubToken: "gh",
    });

    // stale machine destroyed (force) + a fresh one created on GHCR
    const del = calls.find(
      (c) => c.method === "DELETE" && c.url.includes("/machines/m-stale"),
    )!;
    expect(del.url).toContain("force=true");
    const create = calls.find(
      (c) => c.method === "POST" && c.url.endsWith("/machines"),
    )!;
    expect((create.body as { config: { image: string } }).config.image).toBe(
      DEFAULT_IMAGE,
    );
    expect(out.machineId).toBe("m-fresh");
    // existing BRAIN_API_KEY is preserved across the recreate
    expect(out.apiKey).toBe("old-key");
    expect(
      (create.body as { config: { env: Record<string, string> } }).config.env
        .BRAIN_API_KEY,
    ).toBe("old-key");
  });

  it("reuses (does NOT recreate) when the image already matches, digest aside", async () => {
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith("/apps/kody-brain-alice"))
        return { json: { name: "kody-brain-alice" } };
      if (call.method === "GET" && call.url.endsWith("/machines"))
        return {
          json: [
            {
              id: "m-good",
              state: "started",
              region: "fra",
              config: {
                image: `${DEFAULT_IMAGE}@sha256:fresh`,
                env: { BRAIN_API_KEY: "live-key" },
              },
            },
          ],
        };
      if (call.method === "DELETE" || call.method === "POST")
        throw new Error(`must not mutate on a matching image: ${call.url}`);
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });

    const out = await provisionBrain({
      flyToken: TOKEN,
      account: "alice",
      githubToken: "gh",
    });
    expect(out.machineId).toBe("m-good");
    expect(out.apiKey).toBe("live-key");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// allocateIpsIfMissing: graphql IP allocation
//
// These tests use their own fetch stub directly (not installFetchStub) so the
// default "/ips returns existing entries" shortcut is bypassed and we can
// exercise the allocation path end-to-end.
// ────────────────────────────────────────────────────────────────────────────

describe("allocateIpsIfMissing", () => {
  function installRawStub(
    handler: (url: string, init?: RequestInit) => Response,
  ): RecordedCall[] {
    const calls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body =
          typeof init?.body === "string" && init.body.length > 0
            ? JSON.parse(init.body)
            : undefined;
        calls.push({ url, method, body, headers: {} });
        return handler(url, init);
      }),
    );
    return calls;
  }

  it("skips allocation when the app already has at least one IP", async () => {
    const calls = installRawStub(
      () =>
        new Response(JSON.stringify([{ id: "ip-1", address: "1.2.3.4" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await allocateIpsIfMissing(TOKEN, "kody-brain-alice");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/apps/kody-brain-alice/ips");
  });

  it("allocates shared_v4 + v6 via GraphQL when no IPs exist", async () => {
    const calls = installRawStub((url) => {
      if (url.includes("/apps/kody-brain-alice/ips")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://api.fly.io/graphql") {
        return new Response(
          JSON.stringify({
            data: {
              allocateIpAddress: { ipAddress: { id: "ip-x", address: "x" } },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    });
    await allocateIpsIfMissing(TOKEN, "kody-brain-alice");
    const graphqlCalls = calls.filter(
      (c) => c.url === "https://api.fly.io/graphql",
    );
    expect(graphqlCalls).toHaveLength(2);
    const types = graphqlCalls.map(
      (c) => (c.body as { variables: { type: string } }).variables.type,
    );
    expect(types).toEqual(["shared_v4", "v6"]);
  });

  it('treats a 404 on /ips as "no IPs yet" and allocates', async () => {
    let graphqlHits = 0;
    installRawStub((url) => {
      if (url.includes("/apps/kody-brain-alice/ips")) {
        return new Response(null, { status: 404 });
      }
      if (url === "https://api.fly.io/graphql") {
        graphqlHits += 1;
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    await allocateIpsIfMissing(TOKEN, "kody-brain-alice");
    expect(graphqlHits).toBe(2);
  });

  it("throws when GraphQL returns errors", async () => {
    installRawStub((url) => {
      if (url.includes("/apps/kody-brain-alice/ips")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ errors: [{ message: "Org has no payment method" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    await expect(
      allocateIpsIfMissing(TOKEN, "kody-brain-alice"),
    ).rejects.toThrow(/payment method/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// destroyBrain: idempotent teardown
// ────────────────────────────────────────────────────────────────────────────

describe("destroyBrain", () => {
  it("returns silently when the app does not exist", async () => {
    installFetchStub(() => ({ status: 404 }));
    await expect(
      destroyBrain({ flyToken: TOKEN, account: "alice" }),
    ).resolves.toBeUndefined();
  });

  it("issues DELETE on the app when it exists", async () => {
    const calls = installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (
        call.method === "DELETE" &&
        call.url.includes("/apps/kody-brain-alice")
      ) {
        return { status: 200, json: { ok: true } };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    await destroyBrain({ flyToken: TOKEN, account: "alice" });
    const del = calls.find((c) => c.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.url).toContain("force=true");
  });

  it("rejects when flyToken is empty", async () => {
    await expect(
      destroyBrain({ flyToken: "", account: "alice" }),
    ).rejects.toThrow(/flyToken required/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// brainStatus: state mapping
// ────────────────────────────────────────────────────────────────────────────

describe("brainStatus", () => {
  it("returns state='off' when no app exists", async () => {
    installFetchStub(() => ({ status: 404 }));
    const out = await brainStatus({ flyToken: TOKEN, account: "alice" });
    expect(out).toEqual({ app: "kody-brain-alice", state: "off" });
  });

  it("returns state='off' with url when the app exists but has no live machines", async () => {
    installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines")) {
        return { json: [{ id: "m-old", state: "destroyed" }] };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    const out = await brainStatus({ flyToken: TOKEN, account: "alice" });
    expect(out.state).toBe("off");
    expect(out.url).toBe("https://kody-brain-alice.fly.dev");
  });

  it("maps started/starting to running", async () => {
    installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines")) {
        return { json: [{ id: "m", state: "started", config: { env: {} } }] };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    const out = await brainStatus({ flyToken: TOKEN, account: "alice" });
    expect(out.state).toBe("running");
    expect(out.machineId).toBe("m");
  });

  it("maps suspended/suspending to suspended", async () => {
    installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines")) {
        return { json: [{ id: "m", state: "suspended" }] };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    const out = await brainStatus({ flyToken: TOKEN, account: "alice" });
    expect(out.state).toBe("suspended");
  });

  it("maps anything else to stopped", async () => {
    installFetchStub((call) => {
      if (
        call.method === "GET" &&
        call.url.endsWith("/apps/kody-brain-alice")
      ) {
        return { json: { name: "kody-brain-alice" } };
      }
      if (call.method === "GET" && call.url.endsWith("/machines")) {
        return { json: [{ id: "m", state: "stopped" }] };
      }
      throw new Error(`unexpected: ${call.method} ${call.url}`);
    });
    const out = await brainStatus({ flyToken: TOKEN, account: "alice" });
    expect(out.state).toBe("stopped");
  });

  it("rejects when flyToken is empty", async () => {
    await expect(
      brainStatus({ flyToken: "", account: "alice" }),
    ).rejects.toThrow(/flyToken required/);
  });
});
