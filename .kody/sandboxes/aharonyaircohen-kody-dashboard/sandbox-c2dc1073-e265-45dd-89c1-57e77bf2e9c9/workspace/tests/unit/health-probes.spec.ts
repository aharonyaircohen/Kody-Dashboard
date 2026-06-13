import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  probeGitHubActionsStatus,
  __resetGitHubStatusCache,
} from "@dashboard/lib/health/github-status";
import { probeTokenHealth } from "@dashboard/lib/health/token-health";
import {
  probeWebhookHealth,
  __resetWebhookCache,
} from "@dashboard/lib/health/webhook-health";
import { buildHealthReport } from "@dashboard/lib/health/report";
import { __resetDispatchFailures } from "@dashboard/lib/health/dispatch-failures";

/** Build a fetch stub returning the given JSON body + ok flag. */
function jsonFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status: ok ? status : status }),
  ) as unknown as typeof fetch;
}
function throwingFetch(): typeof fetch {
  return vi.fn(async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  __resetGitHubStatusCache();
  __resetWebhookCache();
  __resetDispatchFailures();
});

describe("probeGitHubActionsStatus (glue)", () => {
  it("reads the live Actions component", async () => {
    const f = jsonFetch({
      components: [{ name: "Actions", status: "major_outage" }],
    });
    const sig = await probeGitHubActionsStatus(f);
    expect(sig.level).toBe("down");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caches within the TTL (second call does not re-fetch)", async () => {
    const f = jsonFetch({
      components: [{ name: "Actions", status: "operational" }],
    });
    await probeGitHubActionsStatus(f);
    await probeGitHubActionsStatus(f);
    expect(f).toHaveBeenCalledTimes(1); // served from cache
  });

  it("fails soft (ok) when the status page is unreachable", async () => {
    const sig = await probeGitHubActionsStatus(throwingFetch());
    expect(sig.level).toBe("ok");
    expect(sig.detail).toMatch(/could not reach/i);
  });

  it("fails soft on a non-2xx status page response", async () => {
    const sig = await probeGitHubActionsStatus(jsonFetch({}, false, 503));
    expect(sig.level).toBe("ok");
  });
});

describe("probeTokenHealth (glue)", () => {
  const reset = Math.floor(Date.now() / 1000) + 1800;

  it("no token is down", async () => {
    const sig = await probeTokenHealth(null, jsonFetch({}));
    expect(sig.level).toBe("down");
  });

  it("classifies a healthy core reading", async () => {
    const f = jsonFetch({
      resources: { core: { limit: 5000, remaining: 4900, reset } },
    });
    const sig = await probeTokenHealth("tok", f);
    expect(sig.level).toBe("ok");
  });

  it("classifies the throttled (60/hr) reading as down", async () => {
    const f = jsonFetch({
      resources: { core: { limit: 60, remaining: 46, reset } },
    });
    const sig = await probeTokenHealth("tok", f);
    expect(sig.level).toBe("down");
  });

  it("degrades when the rate-limit endpoint errors", async () => {
    expect((await probeTokenHealth("tok", throwingFetch())).level).toBe(
      "degraded",
    );
    expect(
      (await probeTokenHealth("tok", jsonFetch({}, false, 403))).level,
    ).toBe("degraded");
  });
});

describe("probeWebhookHealth (glue)", () => {
  function octokitWith(hooks: unknown[], deliveries: unknown[]): any {
    return {
      rest: { repos: { listWebhooks: vi.fn(async () => ({ data: hooks })) } },
      request: vi.fn(async () => ({ data: deliveries })),
    };
  }

  it("summarizes successful deliveries", async () => {
    const ok = octokitWith(
      [{ id: 1, active: true, config: { url: "x/api/webhooks/github" } }],
      [{ status_code: 200 }, { status_code: 204 }],
    );
    const sig = await probeWebhookHealth(ok, "o", "r");
    expect(sig.level).toBe("ok");
  });

  it("reports all-failed deliveries as down", async () => {
    const bad = octokitWith(
      [{ id: 1, active: true, config: { url: "x/api/webhooks/github" } }],
      [{ status_code: 500 }, { status_code: 502 }],
    );
    expect((await probeWebhookHealth(bad, "o", "r")).level).toBe("down");
  });

  it("degrades when there is no hook", async () => {
    expect(
      (await probeWebhookHealth(octokitWith([], []), "o", "r")).level,
    ).toBe("degraded");
  });

  it("degrades when the API throws", async () => {
    const boom: any = {
      rest: {
        repos: {
          listWebhooks: vi.fn(async () => {
            throw new Error("x");
          }),
        },
      },
      request: vi.fn(),
    };
    expect((await probeWebhookHealth(boom, "o", "r")).level).toBe("degraded");
  });
});

describe("buildHealthReport (aggregator)", () => {
  const reset = Math.floor(Date.now() / 1000) + 1800;

  afterEach(() => vi.unstubAllGlobals());

  function stubNetwork(
    actionsStatus: string,
    core: { limit: number; remaining: number },
  ) {
    // github-status + token both use global fetch; route by URL.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("githubstatus.com")) {
          return new Response(
            JSON.stringify({
              components: [{ name: "Actions", status: actionsStatus }],
            }),
          );
        }
        return new Response(
          JSON.stringify({ resources: { core: { ...core, reset } } }),
        );
      }),
    );
  }
  // Healthy webhook: one active hook + all-200 deliveries, so the rollup is
  // driven by the signals each test actually varies (Actions, token).
  const octokit: any = {
    rest: {
      repos: {
        listWebhooks: vi.fn(async () => ({
          data: [
            { id: 1, active: true, config: { url: "x/api/webhooks/github" } },
          ],
        })),
      },
    },
    request: vi.fn(async () => ({ data: [{ status_code: 200 }] })),
  };
  const base = {
    octokit,
    owner: "o",
    repo: "r",
    token: "tok",
    runs: [
      {
        status: "completed" as const,
        conclusion: "success",
        createdAt: new Date().toISOString(),
      },
    ],
    modelSpec: "minimax/x",
    hasModelKey: true,
    vaultConfigured: true,
    hasVaultGithubToken: true,
  };

  it("rolls up to down when Actions is out", async () => {
    stubNetwork("major_outage", { limit: 5000, remaining: 4900 });
    const report = await buildHealthReport({ ...base, now: Date.now() });
    expect(report.level).toBe("down");
    expect(report.signals.find((s) => s.id === "github-actions")?.level).toBe(
      "down",
    );
    // worst-first ordering puts a down signal first
    expect(report.signals[0]?.level).toBe("down");
    // every probe is present
    expect(report.signals.map((s) => s.id).sort()).toEqual(
      [
        "dispatch",
        "engine-runs",
        "github-actions",
        "model",
        "token",
        "vault",
        "webhook",
      ].sort(),
    );
  });

  it("rolls up to ok when everything is healthy", async () => {
    stubNetwork("operational", { limit: 5000, remaining: 4900 });
    const report = await buildHealthReport({ ...base, now: Date.now() });
    expect(report.level).toBe("ok");
  });
});
