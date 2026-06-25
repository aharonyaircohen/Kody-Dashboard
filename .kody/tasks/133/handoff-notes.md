# Issue #133 — chat header / sidebar buttons → icon-only

Three buttons had redundant text labels duplicating their icons. Converted each to a single lucide-react icon, aligned to the existing icon-only chat-header pattern (p-2 padding, w-4 h-4 icons, aria-label + title preserved).

- `SessionSidebar.tsx` line 139-148: "+ New conversation" was a text-only primary button. Replaced with `<Plus />` icon button (p-2, bg-primary, aria-label + title). Added `Plus` import from `lucide-react`.
- `KodyChat.tsx` line 4075-4108: the "New conversation" and "Chats" header buttons each rendered `<span className="hidden sm:inline">…</span>` next to their existing icons. Dropped the spans, dropped the `flex items-center gap-1.5` wrapper (no gap needed), dropped the `px-2.5 py-1.5` horizontal padding, bumped icon size from w-3.5 to w-4 to match the collapse/fullscreen siblings. Disabled-state styling and active-state styling for the Chats toggle preserved.

Test: new `tests/unit/chat/chat-header-icon-only.spec.ts` (7 assertions). Uses the same source-level structural pattern as `kody-chat-composer.spec.ts` — reads the file as text, finds each button via a unique marker, then asserts JSX structure (icon present, no text span, aria-label + title present). The "Conversations" heading assertion confirms the sidebar header is not regressed.

Verify gate: `ok: true` on attempt 1 — typecheck, lint, full test suite all green. No regressions in the 1252-test unit suite.
