import { describe, it, expect, beforeEach } from "vitest";
import { rollupLevel, orderSignals, countByLevel } from "@dashboard/lib/health/rollup";
import {
  mapActionsComponentStatus,
  findActionsComponent,
} from "@dashboard/lib/health/github-status";
import { classifyRateLimit } from "@dashboard/lib/health/token-health";
import { keyNameForModelSpec, buildModelSignal } from "@dashboard/lib/health/model-health";
import { buildVaultSignal } from "@dashboard/lib/health/vault-health";
import { classifyDeliveries } from "@dashboard/lib/health/webhook-health";
import { buildRunsSignal, type RunLite } from "@dashboard/lib/health/runs-health";
import {
  recordDispatchFailure,
  recentDispatchFailures,
  buildDispatchSignal,
  __resetDispatchFailures,
} from "@dashboard/lib/health/dispatch-failures";
import type { HealthSignal } from "@dashboard/lib/health/types";

const sig = (id: string, level: HealthSignal["level"]): HealthSignal => ({
  id,
  label: id,
  level,
  detail: "",
});

describe("rollup", () => {
  it("worst level wins", () => {
    expect(rollupLevel([sig("a", "ok"), sig("b", "ok")])).toBe("ok");
    expect(rollupLevel([sig("a", "ok"), sig("b", "degraded")])).toBe("degraded");
    expect(rollupLevel([sig("a", "degraded"), sig("b", "down")])).toBe("down");
    expect(rollupLevel([])).toBe("ok");
  });

  it("orders worst-first, stable within a level", () => {
    const out = orderSignals([
      sig("a", "ok"),
      sig("b", "down"),
      sig("c", "degraded"),
      sig("d", "down"),
    ]);
    expect(out.map((s) => s.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("counts by level", () => {
    expect(countByLevel([sig("a", "down"), sig("b", "down"), sig("c", "ok")])).toEqual({
      ok: 1,
      degraded: 0,
      down: 2,
    });
  });
});

describe("github actions status mapping", () => {
  it("maps the statuspage vocabulary", () => {
    expect(mapActionsComponentStatus("operational").level).toBe("ok");
    expect(mapActionsComponentStatus("degraded_performance").level).toBe("degraded");
    expect(mapActionsComponentStatus("partial_outage").level).toBe("down");
    expect(mapActionsComponentStatus("major_outage").level).toBe("down");
    expect(mapActionsComponentStatus("under_maintenance").level).toBe("degraded");
    expect(mapActionsComponentStatus(undefined).level).toBe("ok"); // don't cry wolf
  });

  it("finds the Actions component case-insensitively", () => {
    expect(findActionsComponent([{ name: "Pages" }, { name: "Actions", status: "operational" }])?.status).toBe(
      "operational",
    );
    expect(findActionsComponent([{ name: "actions", status: "major_outage" }])?.status).toBe(
      "major_outage",
    );
    expect(findActionsComponent([{ name: "Git Operations" }])).toBeUndefined();
  });
});

describe("token rate-limit classification", () => {
  const reset = Math.floor(Date.now() / 1000) + 1800;
  it("flags the kodyade 60/hr case as down", () => {
    expect(classifyRateLimit({ limit: 60, remaining: 46, reset }).level).toBe("down");
  });
  it("exhausted window is down", () => {
    expect(classifyRateLimit({ limit: 5000, remaining: 0, reset }).level).toBe("down");
  });
  it("low remaining is degraded", () => {
    expect(classifyRateLimit({ limit: 5000, remaining: 50, reset }).level).toBe("degraded");
  });
  it("healthy is ok", () => {
    expect(classifyRateLimit({ limit: 5000, remaining: 4900, reset }).level).toBe("ok");
  });
});

describe("model key resolution", () => {
  it("uses preset keyHint where known", () => {
    expect(keyNameForModelSpec("anthropic/claude")?.keyName).toBe("ANTHROPIC_API_KEY");
    expect(keyNameForModelSpec("google/gemini-2.0")?.keyName).toBe("GEMINI_API_KEY");
  });
  it("falls back to <PROVIDER>_API_KEY for unknown providers", () => {
    expect(keyNameForModelSpec("minimax/MiniMax-M2.7-highspeed")?.keyName).toBe(
      "MINIMAX_API_KEY",
    );
  });
  it("rejects empty/garbage", () => {
    expect(keyNameForModelSpec("")).toBeNull();
  });
  it("buildModelSignal: missing key is down, present is ok, unset is degraded", () => {
    expect(buildModelSignal({ modelSpec: null, hasKey: false }).level).toBe("degraded");
    expect(buildModelSignal({ modelSpec: "minimax/x", hasKey: false }).level).toBe("down");
    expect(buildModelSignal({ modelSpec: "minimax/x", hasKey: true }).level).toBe("ok");
  });
});

describe("vault signal", () => {
  it("unconfigured and no-token are degraded; full is ok", () => {
    expect(buildVaultSignal({ configured: false, hasGithubToken: false }).level).toBe("degraded");
    expect(buildVaultSignal({ configured: true, hasGithubToken: false }).level).toBe("degraded");
    expect(buildVaultSignal({ configured: true, hasGithubToken: true }).level).toBe("ok");
  });
});

describe("webhook delivery classification", () => {
  it("no hook is degraded", () => {
    expect(classifyDeliveries(false, []).level).toBe("degraded");
  });
  it("no deliveries is ok", () => {
    expect(classifyDeliveries(true, []).level).toBe("ok");
  });
  it("all failed is down", () => {
    expect(classifyDeliveries(true, [{ status_code: 500 }, { status_code: 403 }]).level).toBe(
      "down",
    );
  });
  it("some failed is degraded", () => {
    expect(
      classifyDeliveries(true, [{ status_code: 200 }, { status_code: 500 }]).level,
    ).toBe("degraded");
  });
  it("all ok is ok", () => {
    expect(classifyDeliveries(true, [{ status_code: 200 }, { status_code: 204 }]).level).toBe(
      "ok",
    );
  });
});

describe("runs signal", () => {
  const now = Date.parse("2026-05-26T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const run = (min: number, conclusion: string | null): RunLite => ({
    status: "completed",
    conclusion,
    createdAt: ago(min),
  });

  it("no runs is degraded", () => {
    expect(buildRunsSignal([], now).level).toBe("degraded");
  });
  it("3 failures in a row is down", () => {
    expect(
      buildRunsSignal([run(1, "failure"), run(5, "failure"), run(9, "failure")], now).level,
    ).toBe("down");
  });
  it("silence (>1h) is degraded", () => {
    expect(buildRunsSignal([run(90, "success")], now).level).toBe("degraded");
  });
  it("recent success is ok", () => {
    expect(buildRunsSignal([run(5, "success"), run(20, "failure")], now).level).toBe("ok");
  });
});

describe("dispatch failures", () => {
  beforeEach(() => __resetDispatchFailures());

  it("empty is ok", () => {
    expect(buildDispatchSignal(recentDispatchFailures()).level).toBe("ok");
  });
  it("one recent failure is degraded", () => {
    recordDispatchFailure(500, "boom");
    expect(buildDispatchSignal(recentDispatchFailures()).level).toBe("degraded");
  });
  it("a burst (3+) is down", () => {
    recordDispatchFailure(500, "a");
    recordDispatchFailure(500, "b");
    recordDispatchFailure(500, "c");
    const recent = recentDispatchFailures();
    expect(recent.length).toBe(3);
    expect(buildDispatchSignal(recent).level).toBe("down");
  });
  it("drops failures outside the 15-min window", () => {
    recordDispatchFailure(500, "old");
    const future = Date.now() + 16 * 60 * 1000;
    expect(recentDispatchFailures(future)).toHaveLength(0);
  });
});
