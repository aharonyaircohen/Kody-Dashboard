/**
 * Source-level structural test for the "no auto-dispatch on dashboard
 * open" invariant in `KodyChat.tsx` (issue #134).
 *
 * Bug: opening the dashboard at `/` with a configured Brain or chat
 * model was observed to dispatch a `kody.yml` workflow run before the
 * user picked any agent. The chat's internal default is
 * `selectedAgentId="kody-live"`, but a `kody.yml` dispatch must only
 * happen in response to a real user action (send, restart, vibe
 * kickoff) — not on mount, not on agent switch, not on rehydrate.
 *
 * The component is too hook-heavy to render in a node-environment
 * vitest (no `happy-dom` / `@testing-library/react` in the repo), so
 * we follow the same source-level pattern as
 * `tests/unit/chat/kody-chat-composer.spec.ts` and pin the structural
 * markers. If a future refactor reintroduces an auto-fire path, the
 * test fails loudly with the actual line of offending code.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODY_CHAT_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/KodyChat.tsx",
);

// Phase 1.6a moved the live-runner lifecycle (startInteractiveSession,
// rehydrateForScope, the poll/SSE/rehydrate/watchdog effects) into the
// useLiveRunner hook (kody-chat-live-runner.ts). The invariant is
// unchanged; the effect scan now covers BOTH files and the
// rehydrateForScope assertions read the hook source.
const LIVE_RUNNER_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/components/kody-chat-live-runner.ts",
);

const LIVE_RUNNER_SOURCE = readFileSync(LIVE_RUNNER_PATH, "utf8");
const SOURCE =
  readFileSync(KODY_CHAT_PATH, "utf8") + "\n" + LIVE_RUNNER_SOURCE;

/**
 * Iterate every `useEffect` in `source` and return its body + dep array
 * text. Walks balanced braces to extract the body and a balanced
 * bracket pair to extract the dep list. Used by the dispatch-on-mount
 * regression guard below to scan for forbidden `startInteractiveSession`
 * call sites.
 */
function forEachEffect(
  source: string,
  visit: (body: string, depsText: string, depsTrimmed: string) => void,
): void {
  const re = /useEffect\(\s*([^=]*?)\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const arrowStart = m.index + m[0].length;
    let depth = 1;
    let i = arrowStart;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    const body = source.slice(arrowStart, i - 1);
    let j = i;
    while (j < source.length && /\s|,/.test(source[j])) j += 1;
    if (source[j] !== "[") {
      visit(body, "", "");
      continue;
    }
    let depthArr = 1;
    let k = j + 1;
    while (k < source.length && depthArr > 0) {
      const ch = source[k];
      if (ch === "[") depthArr += 1;
      else if (ch === "]") depthArr -= 1;
      k += 1;
    }
    const depsText = source.slice(j, k);
    const depsTrimmed = source.slice(j + 1, k - 1).trim();
    visit(body, depsText, depsTrimmed);
  }
}

describe("KodyChat — no auto-dispatch on dashboard open (issue #134)", () => {
  it("does NOT call startInteractiveSession from any effect on mount (no deps or [auth]-only)", () => {
    // Walk every useEffect in the file. A mount effect is one whose
    // dependency array is empty, contains only stable refs/auth, or
    // is a one-shot hydration effect gated by a `Ref.current` flag.
    // None of them may dispatch /interactive/start. If a future
    // refactor introduces a `useEffect(() => { startInteractiveSession(...) },
    // [])` or similar, this test fails with the actual offending
    // body so the bug can be fixed in a single pass.
    //
    // The known valid dispatch call sites (must remain):
    //   - sendText (line ~2865): user-typed message → first-turn start
    //   - restartInteractiveSession (line ~3240): Restart button click
    //   - send button onClick (line ~4798): user click
    // We pin those exceptions by excluding their dispatch lines.
    const mountEffectCallers = [
      "sendText", // user action
      "restartInteractiveSession", // user action
      "sendMessage", // user action
    ];
    const offenders: string[] = [];
    forEachEffect(SOURCE, (body, _depsText, depsTrimmed) => {
      // Skip non-mount effects: any deps array with a length > 0
      // is (probably) tied to user actions or live updates. We only
      // flag EMPTY-deps effects as mount effects, which is the
      // narrowest possible regression guard.
      if (depsTrimmed.length > 0) return;
      const callsStart = /startInteractiveSession\s*\(/.test(body);
      if (!callsStart) return;
      const allowed = mountEffectCallers.some((name) =>
        new RegExp(`\\b${name}\\b`).test(body),
      );
      if (allowed) return;
      offenders.push(body.slice(0, 240).replace(/\s+/g, " ").trim() + "…");
    });
    expect(
      offenders,
      `mount effects must not call startInteractiveSession. Offending bodies: ${offenders.join("\n---\n")}`,
    ).toEqual([]);
  });

  it("rehydrateForScope does NOT dispatch when no saved session exists", () => {
    // The rehydrate effect runs once on mount (gated by
    // `liveRestoreAttemptedRef`). When loadLiveSession returns null
    // for the active scope, it must dispatch REHYDRATE_IDLE and
    // return — never call startInteractiveSession, which would
    // POST /api/kody/chat/interactive/start and create a fresh
    // GitHub Actions workflow.
    const rehydrateMatch = LIVE_RUNNER_SOURCE.match(
      /const\s+rehydrateForScope\s*=\s*useCallback\(\s*[\s\S]*?\n\s*\}\s*,\s*\[/,
    );
    expect(
      rehydrateMatch,
      "useLiveRunner must define a rehydrateForScope callback",
    ).not.toBeNull();
    const body = rehydrateMatch![0];
    // Locate the "no saved session" branch — guarded by
    // `if (!saved)` between `loadLiveSession(...)` and the early
    // return. Inside that branch, no startInteractiveSession call
    // is allowed.
    const noSavedMatch = body.match(
      /if\s*\(\s*!saved\s*\)\s*\{[\s\S]*?return\s*;\s*\}/,
    );
    expect(
      noSavedMatch,
      "rehydrateForScope must early-return when no saved session exists",
    ).not.toBeNull();
    expect(
      noSavedMatch![0],
      "the no-saved-session branch must not call startInteractiveSession — opening the dashboard with no prior session must not dispatch a workflow",
    ).not.toMatch(/startInteractiveSession/);
  });

  it("rehydrateForScope does not call startInteractiveSession in any branch", () => {
    // Belt-and-suspenders: even when a saved session IS present,
    // rehydration must only POLL the existing runner — never spawn
    // a fresh one. The fix for issue #134 added Live to the dropdown
    // so the user can see (and pick) the actual default; this
    // assertion pins the runtime contract that rehydration never
    // invents a new runner.
    const rehydrateMatch = LIVE_RUNNER_SOURCE.match(
      /const\s+rehydrateForScope\s*=\s*useCallback\(\s*[\s\S]*?\n\s*\}\s*,\s*\[/,
    );
    expect(rehydrateMatch).not.toBeNull();
    expect(
      rehydrateMatch![0],
      "rehydrateForScope must only re-poll existing sessions, not dispatch new ones",
    ).not.toMatch(/startInteractiveSession/);
  });
});
