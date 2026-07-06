import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("rate limit polling guardrails", () => {
  it("keeps the first six hot internal pages on slower or cached paths", () => {
    expect(
      source("src/dashboard/lib/components/FlyPreviewsList.tsx"),
    ).toContain("const REFRESH_MS = 60_000");
    expect(
      source("src/dashboard/lib/components/KodyChat.tsx"),
    ).toContain("const BRAIN_IMAGE_SAVE_POLL_INTERVAL_MS = 10_000");
    expect(
      source("src/dashboard/lib/components/BrainImagesManager.tsx"),
    ).toContain("/api/kody/brain/image?jobId=");
    expect(
      source("src/dashboard/lib/hooks/useChatTerminalRegistry.ts"),
    ).toContain("setInterval(() => void refreshStatus(), 60_000)");
    expect(source("src/dashboard/lib/hooks/useManagedGoals.ts")).toContain(
      "refetchInterval: 60_000",
    );
    expect(source("src/dashboard/lib/hooks/useCompanyIntents.ts")).toContain(
      "refetchInterval: 120_000",
    );
  });

  it("uses server-side caches for expensive repeated reads", () => {
    expect(source("src/dashboard/lib/brain/image-catalog.ts")).toContain(
      "discoveredImagesCache.get",
    );
    expect(
      source("src/dashboard/lib/runners/fly-inventory-server.ts"),
    ).toContain("listFlyInventoryCached");
    expect(source("src/dashboard/lib/managed-goals-files.ts")).toContain(
      "managedGoalFilesCache.get",
    );
    expect(
      source("src/dashboard/lib/managed-goal-run-logs.ts"),
    ).toContain("runLogsCache.get");
    expect(
      source("src/dashboard/lib/company-intents-read-cache.ts"),
    ).toContain("companyIntentRecordsCache");
  });
});
