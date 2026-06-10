# Issue #161 — Doc coverage for notifications/channels

Added `@ai-summary` JSDoc headers to the four channel adapters that were missing
them: `slack.ts`, `discord.ts`, `telegram.ts`, `generic.ts`. The central file
`index.ts` already carried a comprehensive folder-level header covering the
client/server split (and the issue body itself counted it as "present"), so it
was left alone.

Each new header follows the sibling-module convention used by `web-push.ts`,
`inbox.ts`, `mention-push.ts`, `push-core.ts`, `web-push-validate.ts`, and
`send.ts` — `@fileType` / `@domain` / `@pattern` / `@ai-summary` — and calls
out the per-adapter contract plus the load-bearing trap (Discord 2000-char
content cap, Telegram's plain-text mrkdwn, generic's form-mode validation
gap, URL-as-credential for Slack/Discord). The summary captures WHY and TRAP,
not a restatement of the code.

No behaviour changes, no test additions: there are no existing tests for these
modules (verified by `Glob` on `**/channels/**/*.test.ts`).

The follow-up run also ran `prettier --write` on the two files the verify gate
flagged (`app/api/kody/docs/route.ts`, `tests/unit/auth-me.spec.ts`) — these
were pre-existing format drift, not introduced by this work, but reformatting
them in the same commit keeps the gate green. The verify gate now reports
`ok:true` with all checks passing.
