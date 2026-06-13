/**
 * Source-level structural test for the screen wake-lock handling in
 * `useVoiceChat.ts` (issue #148).
 *
 * Background — Android Chrome + Wake Lock API:
 *   1. The OS releases the page's WakeLockSentinel automatically the
 *      instant the tab/page goes hidden (screen off / app switcher).
 *   2. When the user taps the screen to wake the page back up, Chrome
 *      fires `visibilitychange` → "visible" SYNCHRONOUSLY, but the tap
 *      that caused the wake-up isn't yet counted as a "user gesture"
 *      for the Wake Lock API at that exact microtask.
 *   3. `navigator.wakeLock.request("screen")` called straight from the
 *      handler therefore throws `NotAllowedError`, the call is silently
 *      swallowed, and the screen dims ~30s later — same as if wake
 *      lock had been disabled.
 *
 * Mitigations this test pins so a future refactor can't regress:
 *   (a) `resumeConversation` must re-acquire the wake lock (the
 *       `pauseConversation` ↔ `resumeConversation` round trip is the
 *       primary way a long voice conversation is paused on mobile).
 *   (b) The post-`visibilitychange` re-acquire must be deferred via
 *       `setTimeout` so the wake-up tap is treated as a user gesture
 *       by the time the call lands.
 *
 * The component is a hook that drags in `useSpeechRecognition` and
 * `useKodyTTSPiper` (browser-only APIs) — too much surface to unit-test
 * under a node-environment vitest without `happy-dom` /
 * `@testing-library/react`, neither of which is in the repo. We follow
 * the source-level pattern from `preview-actions-merge-button.spec.ts`
 * and assert on the source directly.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(
  __dirname,
  "../../../src/dashboard/lib/hooks/useVoiceChat.ts",
);

const SOURCE = readFileSync(HOOK_PATH, "utf8");

function extractFunctionBody(source: string, name: string): string | null {
  // Match `const <name> = useCallback(() => { ... }, [...])` and grab the
  // body between the opening `{` and the matching `}`. Uses [\s\S] so newlines
  // are matched; the function body has no nested braces in this file.
  const re = new RegExp(
    `const\\s+${name}\\s*=\\s*useCallback\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{([\\s\\S]*?)\\n\\s*\\},`,
  );
  const m = source.match(re);
  return m ? m[1] : null;
}

function extractVisibilityHandlerBody(source: string): string | null {
  // The handler is the inner `handleVisibilityChange` arrow registered in
  // the visibility-change useEffect. Match its body between `{` and the
  // next `}` at the same indent (no nested braces inside). The handler
  // is or isn't `async` — the test only cares about the body, not the
  // signature.
  const re =
    /handleVisibilityChange\s*=\s*(?:async\s*)?\(\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\};/;
  const m = source.match(re);
  return m ? m[1] : null;
}

describe("useVoiceChat — screen wake lock (issue #148)", () => {
  it("re-acquires the wake lock when the user resumes a paused conversation", () => {
    // (a) Without this, a Pause → Resume cycle silently drops the screen
    //     wake lock, and the screen dims ~30s into the next turn.
    const body = extractFunctionBody(SOURCE, "resumeConversation");
    expect(body, "resumeConversation body must be parseable").not.toBeNull();
    expect(
      body!,
      "resumeConversation must call acquireWakeLock() so the screen stays on after a Pause → Resume cycle",
    ).toMatch(/acquireWakeLock\s*\(\s*\)/);
  });

  it("defers the post-visibility-change re-acquire via setTimeout", () => {
    // (b) On Android Chrome, calling navigator.wakeLock.request() inside
    //     the visibilitychange handler races the user-gesture check and
    //     throws NotAllowedError. A small setTimeout (e.g. 100ms) puts
    //     the request on the next tick so the wake-up tap counts.
    const body = extractVisibilityHandlerBody(SOURCE);
    expect(
      body,
      "handleVisibilityChange body must be parseable from the source",
    ).not.toBeNull();
    expect(
      body!,
      "visibilitychange handler must defer acquireWakeLock() via setTimeout so the wake-up tap registers as a user gesture on Android Chrome",
    ).toMatch(/setTimeout/);
  });

  it("re-checks conversation state inside the deferred wake-lock re-acquire", () => {
    // The setTimeout could fire after the user has stopped the
    // conversation (or another tab took over). Re-check the refs at
    // tick time so we don't acquire a lock the caller no longer wants.
    const body = extractVisibilityHandlerBody(SOURCE);
    expect(
      body,
      "handleVisibilityChange body must be parseable",
    ).not.toBeNull();
    // The setTimeout callback must inspect the live state/wakeLockRef —
    // i.e. it must contain both `setTimeout` AND a guard re-check
    // (stateRef / wakeLockRef) before the acquire call.
    const timerBlock = body!.match(
      /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,/,
    );
    expect(
      timerBlock,
      "setTimeout callback body must be parseable",
    ).not.toBeNull();
    const inner = timerBlock![1];
    expect(
      inner,
      "setTimeout callback must re-check wakeLockRef.current before re-acquiring",
    ).toMatch(/wakeLockRef\.current/);
    expect(
      inner,
      "setTimeout callback must re-check stateRef.current before re-acquiring",
    ).toMatch(/stateRef\.current/);
  });
});
