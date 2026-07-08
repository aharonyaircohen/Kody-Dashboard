# Phase 1 — Chat as a pluggable platform

Goal: the chat becomes the abstract core of the dashboard. Everything on top
(terminal mode, vibe, goals, slash commands, branding) becomes a **plugin**
that registers itself — including its tools — into the chat core. Admin chat
behavior must not change at any step.

## Target architecture

```
src/dashboard/lib/chat/
  core/          # pure TS: session store, reducer, streaming, transport
  platform/      # plugin contract, registry, capability grants, slots
  surface/       # ChatSurface UI: composer, messages, sessions sidebar
  plugins/       # terminal/, vibe/, goals/, commands/, branding/, ...
```

- **Core** owns sessions, messages, streaming, model/effort selection.
- **Platform** owns the `ChatPlugin` contract: `{ id, capabilities, tools,
  slots (header/composer/message renderers), agents?, theme? }` plus a
  registry that surfaces mount. Plugins get full access **per granted
  capability** — admin surface grants all, client/brand surface grants few.
- **Surface** renders core state + registered slots. `KodyChat` becomes a
  thin composition; `ClientChatSurface` becomes core + branding plugin.

## Standing rules (every step)

- **Clean architecture**: one module per concern, files ≤ 800 lines
  (target 200–400), no god-components, no cross-layer imports
  (core never imports surface; plugins import platform, never each other).
- **Coding standards**: immutable updates only, zod at boundaries,
  explicit error handling, no `console.log`, no `any` in new code.
- **i18n from the start**: every new/extracted UI string goes through the
  locale layer (no hardcoded user-facing text in new modules); layouts use
  logical CSS (`start`/`end`) so RTL works by direction flip.

## Test layers (all four required at every step)

| Layer | Runner | Scope | Script |
| ----- | ------ | ----- | ------ |
| unit  | vitest (node env, no DOM) | reducers, registry, capability logic, pure helpers | `pnpm test:unit` |
| int   | vitest | plugin registration + core state flows, API route handlers, fixture plugin | `pnpm test:int` |
| smoke | Playwright, fast | routes load, key chrome present (`chat-rail-smoke` pattern) | `pnpm test:smoke` |
| e2e   | Playwright, mocked flows | full admin regression + client surface + live flow | `pnpm test:e2e` |

## Steps

Each step lands as its own commit on main with all four layers green.
Behavior is identical after every step — the e2e regression specs are the
contract.

**Step 0 — Safety net + test rig.**
Add the four `test:*` scripts and tag existing specs into layers. Extend
`admin-chat-regression.spec.ts` to also cover terminal mode, slash commands,
attachments, and session switching (the features later steps will move).
Add a smoke suite (route loads for `/`, `/chat`, `/client/kody`).

**Step 1 — Platform contracts.**
Create `chat/platform/`: `ChatPlugin` type, `PluginRegistry`
(register/resolve/order), capability model (`tools`, `terminal`,
`agents:all`, `theme`, ...). Pure TS. Unit tests for registry + capability
gating; int test with a fixture plugin.

**Step 2 — Extract the state core.**
Move `kody-chat-reducer`, `kody-chat-live-session`, session persistence, and
streaming glue out of `KodyChat.tsx` into `chat/core/` as pure modules with
explicit inputs (no component state reads). Unit tests on each module; int
test driving a full send→stream→persist cycle with a mock transport.

**Step 3 — Extract the surface.**
Split `KodyChat.tsx` (~6,950 lines) into `chat/surface/` pieces: Composer,
MessageList (wraps `MessagesView`), SessionsPanel (wraps `SessionSidebar`),
HeaderControls. `KodyChat` becomes composition + wiring only (< 800 lines).
Smoke + full e2e regression must stay green; no new behavior.

**Step 4 — Slot + tool mount points.**
Surface renders registry slots: header actions, composer actions, message
renderers, footer. Core exposes `registerTools()` so a plugin's tools reach
the chat backends (in-process kody tools first; engine/brain pass-through
later). Int tests with a fixture plugin proving a registered tool is callable
and a slot renders.

**Step 5 — Move features into plugins (one commit each, deepest part).**
5a terminal mode → `plugins/terminal` (owns `ChatTerminalSurface`, its
composer toggle, its registry hook). 5b slash commands → `plugins/commands`.
5c vibe mode → `plugins/vibe`. 5d goals/dashboard context → `plugins/goals`.
5e attachments/voice stay core (they're chat-shaped, not dashboard-shaped).
After each: unit tests for the plugin, int test for its registration, e2e
regression green.

**Step 5.5 — Locale + RTL layer.**
`chat/platform/i18n`: locale provider (default `en`), message catalog with
per-plugin namespaces (`plugin.terminal.toggle`), `dir` derived from locale
and applied at the surface root, logical-CSS audit of extracted surface
pieces. Brand config gains an optional `locale`. Unit tests for catalog
resolution + fallback; e2e asserts an RTL locale flips direction without
breaking layout (extends existing `text-direction` / rtl spec patterns).

**Step 6 — Branding as a plugin.**
`plugins/branding` provides name/logo/accent/welcome text via the theme
capability. `ClientChatSurface` = ChatSurface + branding plugin + a minimal
capability grant (no terminal, no goals, locked agent later). Client e2e
spec extends to verify theming and absence of admin plugins.

**Step 7 — Enforcement + docs.**
Registry refuses slots/tools outside a plugin's grant (unit-tested). Write
`docs/chat-platform.md` (how to build a plugin). Full four-layer run,
lint, typecheck, clean build (`rm -rf .next && pnpm build` — github-client
bundle rule).

## Order rationale

Tests first (0) so refactors are provable; contracts (1) before extraction
so code moves into its final shape once; state before UI (2→3) because UI
splitting is mechanical once state is external; plugins last (5+) because
they need the mount points from 4.
