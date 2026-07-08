import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Phase 1.6d moved the terminal host wiring (registry aliases, chrome
// nodes, target selector plumbing) to kody-chat-terminal-host.tsx; the
// scan covers both files so the guard still applies where the terminal
// target UI actually lives. Assertions unchanged.
const CHAT_SOURCE =
  readFileSync(
    resolve(__dirname, "../../../src/dashboard/lib/components/KodyChat.tsx"),
    "utf8",
  ) +
  "\n" +
  readFileSync(
    resolve(
      __dirname,
      "../../../src/dashboard/lib/components/kody-chat-terminal-host.tsx",
    ),
    "utf8",
  );

describe("chat terminal target selector", () => {
  it("does not offer GitHub Actions as a terminal target", () => {
    expect(CHAT_SOURCE).not.toContain("value={`gha:${sandbox.id}`}");
    expect(CHAT_SOURCE).not.toContain("GitHub Actions profile:");
    expect(CHAT_SOURCE).not.toContain("Copy to GitHub Actions");
  });
});
