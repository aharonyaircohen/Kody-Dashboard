/**
 * Regression coverage for refresh preserving the selected Kody chat model.
 *
 * Bug: a saved per-session `kody:<model>` key was resolved before
 * /api/kody/models finished loading. The model row was not in the dropdown
 * yet, so the sync path treated it as missing, fell back to Kody Live, and
 * overwrote the session. Refresh then jumped to the default instead of the
 * selected model.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isModelBackedEntryKey,
  shouldWaitForModelBackedEntryResolution,
} from "@dashboard/lib/chat/platform/agent-entries";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/KodyChat.tsx",
);
const KODY_CHAT_SOURCE = readFileSync(KODY_CHAT_PATH, "utf8");

describe("KodyChat refresh selected-model restore", () => {
  it("identifies model-backed chat entries", () => {
    expect(isModelBackedEntryKey("kody:claude-sonnet")).toBe(true);
    expect(isModelBackedEntryKey("kody:gpt-5")).toBe(true);
    expect(isModelBackedEntryKey("kody-live")).toBe(false);
    expect(isModelBackedEntryKey("brain")).toBe(false);
    expect(isModelBackedEntryKey(null)).toBe(false);
    expect(isModelBackedEntryKey(undefined)).toBe(false);
  });

  it("waits for model entries before resolving a saved model pick", () => {
    expect(
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: false,
        chatModelsLoaded: false,
        sessionAgentKey: "kody:claude-sonnet",
      }),
    ).toBe(true);

    expect(
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
        sessionAgentKey: "kody:claude-sonnet",
      }),
    ).toBe(true);

    expect(
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: true,
        chatModelsLoaded: true,
        sessionAgentKey: "kody:claude-sonnet",
      }),
    ).toBe(false);
  });

  it("does not delay static agent restores once sessions are hydrated", () => {
    expect(
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
        sessionAgentKey: "kody-live",
      }),
    ).toBe(false);

    expect(
      shouldWaitForModelBackedEntryResolution({
        sessionHydrated: true,
        chatModelsLoaded: false,
        sessionAgentKey: "brain",
      }),
    ).toBe(false);
  });

  it("wires the restore guard into the per-session sync path", () => {
    const syncBlock = extractRegionAround(
      KODY_CHAT_SOURCE,
      "Per-session agent sync",
    );
    expect(syncBlock).toMatch(/shouldWaitForModelBackedEntryResolution/);
    expect(syncBlock).toMatch(/sessionHydrated:\s*sessionHook\.hydrated/);
    expect(syncBlock).toMatch(/chatModelsLoaded/);
    expect(syncBlock).toMatch(/sessionAgentKey:\s*session\?\.agentKey/);
  });
});

function extractRegionAround(source: string, marker: string): string {
  const idx = source.indexOf(marker);
  if (idx === -1) return "";
  const half = 3000;
  const start = Math.max(0, idx - half);
  const end = Math.min(source.length, idx + half);
  return source.slice(start, end);
}
