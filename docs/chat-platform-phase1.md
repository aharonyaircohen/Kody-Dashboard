# Phase 1 — Chat as a pluggable platform (v2, post-review)

Goal: the chat becomes the abstract core of the dashboard. Everything on top
(terminal mode, vibe, goals, slash commands, branding) becomes a **plugin**
that registers itself — including its tools — into the chat core. Admin chat
behavior must not change at any step.

v2 incorporates the adversarial review
([chat-platform-phase1-review.md](chat-platform-phase1-review.md)) — all
HIGH (H1–H9) and MEDIUM (M1–M6) findings are folded into the sections below.

## Target architecture

```
src/dashboard/lib/chat/
  core/          # pure TS: session store, reducer, transport adapters, i18n-free
  platform/      # plugin contract, registry, capability grants, slots, i18n catalog
  surface/       # ChatSurface UI: composer, messages, sessions sidebar
  plugins/       # terminal/, commands/, vibe/, goals/, branding/, ...
```

- **Core** owns sessions, messages, streaming, model/effort selection.
- **Platform** owns the plugin contract + registry (details below).
- **Surface** renders core state + registered slots. `KodyChat` becomes a
  thin composition; `ClientChatSurface` becomes core + branding plugin.
- The 12 existing flat `src/dashboard/lib/chat/*.ts` modules are assigned to
  layers in Step 2a: reasoning\*, tool-call-strip, attachment-text,
  user-message-format, vision-support, openai-compatible-request,
  page-context, preview-context → `core/`; agent-entries, default-entry →
  `platform/`. No fifth implicit layer outside the lint zones. (nice-to-have)

### Transport (H1)

The real monolith is `sendText` (~1,630-line callback, KodyChat.tsx:2677–4307)
interleaving three protocol families. Step 1 defines, Step 2c implements:

- `ChatTransport`: `send(turn, ctx)` emitting a `ChatEvent` union (`token`,
  `message`, `tool-call`, `tool-result`, `directive`, `status`, `error`,
  `done`), `abort(sessionId)`, restore/status probing.
- **Three adapters, three lifecycle models** — do not force one reducer over
  all of them: brain (server-stateful pinned chat id, sync-SSE), kody-direct
  (client-driven tool loop + `preview_act` chaining), kody-live
  (reducer-driven runner lifecycle via GH Actions trigger).
- Directives (`dashboard-navigate`, `SwitchAgent`) are ChatEvents the
  **surface** interprets — `router`/`toast`/`flushSync` never enter core.
- Adapters are unit-tested against recorded event streams.

### Plugin contract (H2)

Beyond `id, capabilities, tools, slots, agents?, theme?`, the target features
are mostly **not** "slots + tools", so the contract also includes:

- **Ordered send middleware** (transform/consume outgoing text) with
  deterministic registry ordering. A test pins today's precedence: terminal
  intent (`parseKodyTerminalIntent`) before slash expansion
  (`expandSlashCommand`).
- **Per-session plugin state** with plugin-owned persistence key + schema.
- **Host-context read channel** (e.g. goals need `knownGoals`) and an
  **effect/dispatch channel** to the host (e.g. `onDirectToGoal` → scope
  change).
- **Display-mode arbitration in core**: plugins declare exclusive display
  modes; the platform resolves precedence (vibe suppressing terminal must
  never become a plugin→plugin import).

### Client/server tool split (H3)

Tools execute **server-side**. The contract is split accordingly:

- **Client manifest**: slots, capabilities, theme, middleware.
- **Optional server module**: exports tool factories `(serverCtx) => tools`,
  registered in a server-side registry imported by the kody route from a
  **server-only entry point**. Plugin tool handlers must never enter the
  client bundle — verified with the existing clean-build rule
  (`rm -rf .next && pnpm build`).
- Every registered tool requires a **zod input schema** (as
  `app/api/kody/chat/tools/*` already does).
- **Scoped OUT of phase 1**: engine tools (= MCP config generation) and
  brain tools (= out-of-repo protocol change). Consequence, stated plainly:
  **the default admin agent (`kody-live`) does not see plugin tools in
  phase 1** — only the in-process `kody` backend does. No "pass-through
  later" hand-waving.

### Host contract (H4)

- `ChatRailShell` is the **host**. It stays outside the platform; its
  `ChatRailApi` prop surface (scope, composerInjection, attachmentInjection,
  previewContext, onIssueCreated, lockedAgentId, vibeMode, presentation,
  hideTerminalMode, railFullscreen) is a **frozen external contract** for
  phase 1 (fed app-wide and by the out-of-repo element-picker extension).
- ChatRailShell mounts KodyChat **twice** (desktop rail + mobile sheet;
  desktop hidden-not-unmounted). Therefore: core stores + registry are
  instantiated **per KodyChat instance**; plugin definitions are global pure
  data, slot/tool instantiation is per mount. Collapsing the dual mount is
  its own deliberate step with its own e2e — never a side effect.
- Step 3 preserves the injection path and the stable-identity dispatcher
  (ChatRailShell.tsx:313–318) through the Composer extraction, with a test
  driving ChatRailApi injection → chip renders.
- Fix the stale "mounted once" comments (ChatRailShell.tsx:5, 371) while
  in there. (nice-to-have)
- Vibe decision (M2), recorded: **vibe is a host mode** owned by
  core/surface — matching today's reality (route-derived activation in the
  shell, `ChatSessionScope = 'global' | 'vibe-default'`, scope keys in
  live-session). Step 5c rescopes to moving vibe-specific UI/tools/agents
  only; the /vibe page and API route stay host-side.

## Standing rules — enforced, not aspirational (H6)

Enforcement lands in **Step 1** (not Step 7):

- eslint override scoped to `src/dashboard/lib/chat/**`:
  `no-console: error`, `@typescript-eslint/no-explicit-any: error`,
  `max-lines: ["error", 800]`.
- `import/no-restricted-paths` zones (eslint-plugin-import is installed):
  core may not import surface/plugins/components; plugins may import
  platform + core, never sibling plugins; surface not importable by core.
  Also eliminate the existing inversion (`useChatTerminalRegistry.ts:16`
  imports `authHeaders` from components/) by moving it into chat/core.
- Blocking lint (error-level rules) is part of every step's gate. Step 7
  merely re-verifies the zones cover every plugin dir actually created.
- File-size rule applies to **new/extracted modules** (target 200–400,
  max 800). Interim budgets for the monolith: KodyChat.tsx < 2,500 lines
  after Step 3, < 800 after Step 5d (H8).
- Immutable updates; no hardcoded user-facing strings in new/extracted
  modules (they go through the Step 1 catalog); logical CSS
  (`start`/`end`) so RTL works by direction flip.

### Zod boundaries — the named list (M5)

1. Step 2b: the six bare `JSON.parse(raw) as X` casts in
   `kody-chat-live-session.ts` → zod parses with empty-state fallback.
2. Step 2c: a zod event-envelope schema for streamed/ingested payloads.
3. Step 4: zod input schema required per registered tool.
4. Plugin registration + in-repo brand config: TS types + registry
   invariant checks only (compile-time surfaces — zod there is ceremony).
   Brand config becomes a zod boundary if/when it loads from consumer-repo
   files (trigger noted at Steps 5.5/6).

### Locale (H7)

The **minimal i18n scaffold lands in Step 1** (en-only catalog, per-plugin
namespaces, `t()` helper) so Steps 2–5 extract strings into the catalog in
one touch. The rest of locale/RTL stays at Step 5.5.

### Security caveat (M6)

Capability grants are **UI composition, not a security boundary**: everything
executes in the browser with the same localStorage-PAT auth, and any /client
user can hit any API route regardless of what the registry renders. Handing
/client to real external users requires server-side per-surface scoping
(HMAC-scoped surface tokens per the existing chat-token/preview-ticket
patterns) — **phase 2+, out of scope here**.

## Test layers

| Layer | Runner | Scope | Script |
| ----- | ------ | ----- | ------ |
| unit  | vitest (node env, no DOM) | reducers, registry, capability logic, transport adapters vs recorded streams, pure helpers | `pnpm test:unit` |
| int   | vitest (node env) | plugin registration, core state flows, **real route handlers** with fixture server-half plugins | `pnpm test:int` |
| smoke | Playwright, fast, mocked | routes load, key chrome present | `pnpm test:smoke` |
| e2e   | Playwright, mocked flows | full admin regression + client surface + send/stream cycles | `pnpm test:e2e:local` |

**DOM decision:** vitest stays node-only — anything that must *render React*
(slots, chips, composer) is asserted in the Playwright layers, not in vitest.
No jsdom is added in phase 1.

### Execution contract (H5) — the gate must actually run

- Step 0 adds `test:e2e:local`: starts the dev server on :3333 (Playwright
  `webServer` block or wrapper script) and **forces**
  `BASE_URL=http://127.0.0.1:3333`, overriding `.env`'s deployed URL.
- The gate suite is **fully mocked and token-free so a skip is impossible**.
  Token-gated specs (chat-live-flow, chat-rail-smoke, vibe live specs) are an
  optional live backstop, never the gate.
- **Per-commit gate**: unit + int + smoke + a chromium-only chat-scoped e2e
  subset (`tests/e2e/chat-*`, `admin-chat-regression`, `client-chat-surface`,
  `smoke` — `--project=chromium`). The full two-project run happens at
  milestone steps (0, 3, 7). Mobile-chrome is dropped from the per-commit
  gate (chat specs skip on mobile).
- Deployed-URL runs remain a backstop, not the gate. Reconcile the port-3399
  default in `chat-kody-attachments.spec.ts`.

### Layer hygiene (M3)

Step 0 **verifies** (not adds — they exist) the four `test:*` scripts, then:
moves the ~30 specs sitting directly under `tests/` into `tests/unit` or
`tests/int` (including the text-direction/RTL specs Step 5.5 extends), adds a
guard that no `.spec.ts` lives directly under `tests/`, and widens
`test:smoke` to a declared glob (or documents smoke = `smoke.spec.ts` only).

## Steps

Each step lands as its own commit on main with its gate green. Behavior is
identical after every step — the e2e regression specs are the contract.

**Step −1 — Baseline the in-flight tree (M4).**
Land the pending behavior change as its own fix commit **before** Step 0:
`chat-intent.ts` regex tightening + its flipped specs
(`chat-renderer-output.spec.ts`, `tests/unit/view-renderers/chat-intent.spec.ts`).
The remaining test-rig files (package.json scripts, `smoke.spec.ts`) become
the pure Step 0 commit. Commit #1 must not mix behavior and refactor.

**Step 0 — Safety net + test rig (M1, M3, H5, H9).**
- Execution contract + layer hygiene as above.
- Extend the regression net (all mocked, token-free): markdown editor
  renders on /chat (toggle + preview); a `page.route`-intercepted chat POST
  asserts the payload carries the task/dashboard context block; one mocked
  send→stream→render cycle; a stop/abort-mid-stream case; terminal toggle,
  slash menu, attachments, session switching; a VoiceButton-mounts
  assertion; a spec covering simultaneous desktop+mobile mounts (H4).
- **Golden-fixture persistence tests**: load v2 and legacy-unscoped
  `kody-sessions-v3` fixtures, assert migrated shape, snapshot the
  serialized v3 schema; pin the exact localStorage key strings
  (`kody-sessions-v3:<owner>/<repo>`, `kody-default-chat-entry:<owner>/<repo>`,
  `kody-chat:sessions-panel-pinned`) and migration order — a silent format
  change would wipe every user's sessions with all layers green.
- Name `chat-renderer-output.spec.ts` and `chat-kody-attachments.spec.ts`
  as part of the Step-0 contract (multi-part streaming, attachments).
- **Source-text spec audit (H9)**: for each of the ~18 specs that
  `readFileSync` KodyChat.tsx and assert on source text — decide **retire**
  (behavior now covered by the regression net) or **rewrite** as a behavior
  test against the new core module. Re-pointing string assertions at new
  file paths is forbidden. Steps 2–3 delete/replace them in the same commit.
  Exception: `kody-chat-live-session.spec.ts` moves with its module
  unchanged — it *is* the localStorage key/migration contract.

**Step 1 — Contracts + enforcement + i18n scaffold (H1, H2, H3, H6, H7).**
`chat/platform/`: `ChatPlugin` (slots, capabilities, theme, **middleware,
per-session state, host channels, display modes**), `PluginRegistry`
(register/resolve/order, **per-instance instantiation**), capability model,
`ChatTransport` + `ChatEvent` types, client/server tool-split types, the
eslint enforcement zones, and the minimal i18n catalog. Pure TS. Unit tests
for registry ordering, capability gating, catalog fallback; int test with a
fixture plugin.

**Step 2 — Extract the state core, three sub-commits (H8).**
- **2a**: relocate the already-pure modules (`kody-chat-reducer`,
  `kody-chat-live-session`) + assign the flat `chat/*.ts` modules to layers.
  Imports only; `kody-chat-live-session.spec.ts` moves unchanged.
- **2b**: extract session persistence + rehydration ordering (the
  module-level debounce maps, `REHYDRATE_RESTORED` guards at
  KodyChat.tsx:1043–1150) with a unit test pinning the mount-ordering
  contract; zod parses replace the six casts (M5.1).
- **2c**: extract `sendText`'s branches into the three transport adapters
  (H1); zod event envelope (M5.2); send→stream→persist int test with a mock
  transport. Core lands vibe-aware by decision (M2: host mode) but
  brain-terminal coupling moves out of the registry where cheap.

**Step 3 — Split the surface, one piece per commit (H8).**
Composer, MessageList (**extracted from KodyChat's inline transcript block —
`MessagesView` is the /messages team-messaging page, not this**),
SessionsPanel (wraps `SessionSidebar`), HeaderControls. Plugin-bound UI logic
is extracted **directly into `plugins/<x>/` as plain modules** where the seam
is clean (Step 5 then becomes registry wiring — preserves move-once);
otherwise it stays in KodyChat under the interim < 2,500-line budget.
The composerInjection path and stable-identity dispatcher are preserved
(H4), with an injection → chip-renders test. Per-commit gate green each time.

**Step 4 — Slot + middleware mount points, server tool registry (H2, H3).**
Surface renders registry slots (header, composer actions, message renderers,
footer) and runs the send-middleware chain. The server-side tool registry is
integrated into the kody route via a server-only entry; int tests exercise
the **real route handler** with a fixture server-half plugin (registered
tool callable, zod schema enforced). Slot rendering asserted in the
Playwright layers.

**Step 5 — Move features into plugins, named boundaries (M2).**
- **5a terminal**: `ChatTerminalSurface`, the composer toggle, **the
  850-line `useChatTerminalRegistry` hook, and the checkpoint-transport
  shims (KodyChat.tsx:430–465)** — all in scope, listed file by file in the
  commit. Terminal-intent middleware registered with pinned precedence.
- **5b commands**: slash menu UI + `expandSlashCommand` as send middleware.
- **5c vibe** (rescoped per M2 decision): vibe-specific UI/tools/agents move
  to `plugins/vibe`; mode/scope remain host/core. What stays out: /vibe
  page (host), its API route, VibePage components. 2–3 sub-commits, gated on
  the 9 vibe e2e specs (live ones as backstop).
- **5d goals**: host-context read (`knownGoals`) + effect dispatch
  (`onDirectToGoal`); goal-mention middleware (consumes the message) with a
  regression test.
- **5e**: attachments/voice stay core (chat-shaped, not dashboard-shaped).

**Step 5.5 — Locale + RTL, remainder (H7).**
Brand config gains optional `locale`; surface-root `dir` derived from locale
— **must not override the existing per-message direction logic
(`getMessageDirection`, KodyChat.tsx:471–490)**; logical-CSS audit of
extracted surface pieces; RTL e2e (extending the relocated text-direction
specs) asserts the root flips while per-message dir survives.

**Step 6 — Branding as a plugin (M6).**
`plugins/branding` provides name/logo/accent/welcome text via the theme
capability. `ClientChatSurface` = ChatSurface + branding plugin + a minimal
grant that **reproduces its current props** (presentation, hideTerminalMode,
railFullscreen). **Surfaces import only their granted plugins** (per-surface
plugin lists / dynamic `import()` — no global self-registering side-effect
registry), so the /client chunk sheds terminal/vibe/goals code. Route shape
recorded: `/client/[brandSlug]` stays — a root `/[brand]` catch-all is
structurally impossible (`app/[issueNumber]/` owns the root dynamic segment);
vanity paths/subdomains are a later middleware-rewrite decision. Client e2e
extends to theming + absence of admin plugins.

**Step 7 — Enforcement verification + docs + clean build.**
Registry refuses out-of-grant slots/tools/middleware — **client-side**
enforcement, unit-tested (see M6 caveat). Verify the lint zones cover every
plugin dir created in Step 5; verify the /client route chunk excludes
`plugins/terminal|vibe|goals`. Write `docs/chat-platform.md` (how to build a
plugin: manifest, server half, middleware, i18n namespace, capability
grant). Full four-layer run + lint + typecheck + clean build
(`rm -rf .next && pnpm build` — github-client bundle rule).

## Order rationale

Tests first (0) so refactors are provable; contracts + enforcement + i18n
scaffold (1) before extraction so code moves into its final shape once;
state before UI (2→3) because UI splitting is mechanical once state is
external; mount points (4) before plugins (5+) because plugins need them;
locale remainder (5.5) after the strings exist in the catalog; branding (6)
last because it composes everything; 7 verifies what 1 promised.
