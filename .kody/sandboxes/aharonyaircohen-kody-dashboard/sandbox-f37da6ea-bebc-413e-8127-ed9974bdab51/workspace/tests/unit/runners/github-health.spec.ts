import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkGitHubActionsHealth,
  probeActionsStatus,
  _resetActionsHealthCacheForTests,
  DEFAULT_QUEUE_THRESHOLD,
} from "@dashboard/lib/runners/github-health";

function statusResponse(components: Array<{ name: string; status: string }>) {
  return {
    ok: true,
    json: async () => ({ components }),
  } as unknown as Response;
}

beforeEach(() => {
  _resetActionsHealthCacheForTests();
});

describe("probeActionsStatus", () => {
  it("reports operational Actions as not degraded", async () => {
    const fetchImpl = vi.fn(async () =>
      statusResponse([{ name: "Actions", status: "operational" }]),
    ) as unknown as typeof fetch;
    const probe = await probeActionsStatus(fetchImpl);
    expect(probe.degraded).toBe(false);
    expect(probe.label).toBe("operational");
  });

  it("reports degraded_performance as degraded", async () => {
    const fetchImpl = vi.fn(async () =>
      statusResponse([{ name: "Actions", status: "degraded_performance" }]),
    ) as unknown as typeof fetch;
    const probe = await probeActionsStatus(fetchImpl);
    expect(probe.degraded).toBe(true);
    expect(probe.label).toBe("degraded_performance");
  });

  it("fails open (not degraded) when the status fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const probe = await probeActionsStatus(fetchImpl);
    expect(probe.degraded).toBe(false);
    expect(probe.label).toBe("probe_error");
  });

  it("fails open on a non-200 status response", async () => {
    const fetchImpl = vi.fn(
      async () => ({ ok: false, status: 503 }) as Response,
    ) as unknown as typeof fetch;
    const probe = await probeActionsStatus(fetchImpl);
    expect(probe.degraded).toBe(false);
  });

  it("caches a successful probe (second call does not re-fetch)", async () => {
    const fetchImpl = vi.fn(async () =>
      statusResponse([{ name: "Actions", status: "operational" }]),
    ) as unknown as typeof fetch;
    await probeActionsStatus(fetchImpl);
    await probeActionsStatus(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("checkGitHubActionsHealth", () => {
  const operational = () =>
    vi.fn(async () =>
      statusResponse([{ name: "Actions", status: "operational" }]),
    ) as unknown as typeof fetch;

  it("is healthy when operational and the queue is below threshold", async () => {
    const h = await checkGitHubActionsHealth({
      countQueuedRuns: async () => 2,
      fetchImpl: operational(),
    });
    expect(h.healthy).toBe(true);
    expect(h.queuedCount).toBe(2);
    expect(h.queueFull).toBe(false);
  });

  it("is unhealthy when the queue is at/over threshold", async () => {
    const h = await checkGitHubActionsHealth({
      countQueuedRuns: async () => DEFAULT_QUEUE_THRESHOLD,
      fetchImpl: operational(),
    });
    expect(h.healthy).toBe(false);
    expect(h.queueFull).toBe(true);
    expect(h.reason).toContain("queue full");
  });

  it("is unhealthy when status is degraded, regardless of queue", async () => {
    const fetchImpl = vi.fn(async () =>
      statusResponse([{ name: "Actions", status: "major_outage" }]),
    ) as unknown as typeof fetch;
    const h = await checkGitHubActionsHealth({
      countQueuedRuns: async () => 0,
      fetchImpl,
    });
    expect(h.healthy).toBe(false);
    expect(h.statusDegraded).toBe(true);
    expect(h.reason).toContain("major_outage");
  });

  it("treats a failing queue count as 0 (fail open toward github)", async () => {
    const h = await checkGitHubActionsHealth({
      countQueuedRuns: async () => {
        throw new Error("rate limited");
      },
      fetchImpl: operational(),
    });
    expect(h.queuedCount).toBe(0);
    expect(h.healthy).toBe(true);
  });

  it("respects a custom queue threshold", async () => {
    const h = await checkGitHubActionsHealth({
      countQueuedRuns: async () => 3,
      fetchImpl: operational(),
      queueThreshold: 3,
    });
    expect(h.queueFull).toBe(true);
    expect(h.healthy).toBe(false);
  });
});
