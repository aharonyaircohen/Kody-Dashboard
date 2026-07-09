# Phase 3 — Everything pluggable, invisible to the user

Continues [chat-platform-phase2.md](chat-platform-phase2.md). Same method:
mocked gate (`pnpm test:gate`) green per commit, standards + layer zones
enforced, honest boundaries.

**Governing constraint (user decision, 2026-07-09):** the current UI/UX is
the contract. Chat "leads" architecturally (always mounted, primary in the
component tree, pages hosted as plugin panels) — but on-screen proportions,
nav, and page behavior stay exactly as today. Every step below must be
pixel-invisible to the user; the flip is plumbing, not a redesign.

## Steps

**Step 1 — Visual parity for the chat-first mode.**
Today `flipActive` makes chat the full-width main column and shrinks the
routed page to a fixed 560px right panel
([ChatRailShell.tsx](../src/dashboard/lib/components/ChatRailShell.tsx)).
Change the flip branch to render the _classic_ proportions: chat at the
saved rail width (default 440, drag handle kept), page `flex-1`, same
borders, same mobile behavior. After this step, toggle ON vs OFF is
visually identical — the only difference is which code path hosts the page.
Gate: DOM/layout parity assertions on both toggle states.

**Step 2 — Flip the default ON.**
`useChatFirstLayout` defaults to true; the per-user toggle stays for one
release as an escape hatch. Client tracing (`panel:*`, `mode:*` events)
watched for regressions. User-visible change: none.

**Step 3 — Migrate the remaining pages to page-plugins.**
Not yet plugins (10): `cms`, `cms-config`, `content`, `content-model`,
`fly`, `org`, `runner`, `scenario`, `trust`, `views`. One plugin per page,
one commit each, keeping each page's settings surface — same recipe as the
28 in phase 2.4, same lazy-panel bundle discipline as 2.5.

**Step 4 — Retire the legacy shell path.**
With parity proven and the default flipped, delete the toggle and the
non-flip branches in `ChatRailShell` (and `use-chat-first-layout`). Nav
sidebar, header, and routes are untouched — this removes dead code only.
Per-surface bundle sizes re-verified.

**Step 5 — Auto-wire engine plugin tools.**
The MCP bridge (phase 2.1) works but is manual: someone has to add the
`kody-plugin-tools` mcpServers entry via the Capabilities flow. Make the
default `kody-live` backend pick up plugin tools automatically when at
least one plugin registers server tools — fail-open stays (no plugins →
byte-identical dispatch). Closes the "kody-live has no plugin tools"
honest-limit from phase 1.

**Step 6 — Activate surface scoping.**
Phase 2.6 shipped enforcement dormant: backends already honor surface
tickets, but nothing mints them for real external users. Wire /client
brand surfaces to mint scoped tickets so they can face outsiders without
a GitHub PAT. Closes the "grants ≠ security" caveat.

**Step 7 — Brand registry + operator admin UI.**
The parallel track from phase 2: create/edit brands from the dashboard,
feeding the existing branding plugin. Independent of steps 1–6; can run
alongside.

## Order rationale

1–4 are one arc (parity → flip → migrate → delete) and must be sequential.
5 and 6 are independent of the shell arc and of each other. 7 depends
loosely on 6 (external-facing brands want scoping live first).
