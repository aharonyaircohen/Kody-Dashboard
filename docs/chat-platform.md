# Chat platform — how to build a plugin

The dashboard chat is a pluggable platform (phase 1,
[chat-platform-phase1.md](chat-platform-phase1.md)). Features on top of the
chat core — terminal mode, slash commands, vibe, goals, branding — are
**plugins** that register slots, send middleware, display modes, theme,
agents, session state and server tools into a per-mount registry. This doc is
the practical guide: the contract, the server half, host wiring, layering
rules, and a minimal worked example.

> **Security caveat (M6), read first:** capability grants are **UI
> composition, not a security boundary**. Everything client-side executes in
> the browser with the same localStorage-PAT auth; any /client user can hit
> any API route regardless of what the registry renders. Server-side
> per-surface scoping (HMAC surface tokens) is phase 2+.

## Layout

```
src/dashboard/lib/chat/
  core/          # sessions, reducer, live-session persistence, transports — pure, bottom layer
  platform/      # plugin contract, registry, capabilities, i18n, transport types, server tools
  surface/       # ChatSurface pieces: Composer, MessageList, SessionsPanel, HeaderControls,
                 # ChatPluginProvider + ChatPluginSlot mounts
  plugins/       # terminal/ commands/ vibe/ goals/ branding/  ← one dir per plugin
```

Public platform API: [`src/dashboard/lib/chat/platform/index.ts`](../src/dashboard/lib/chat/platform/index.ts).
Surfaces and plugins import from there; the server-tool singleton is
deliberately **not** re-exported from it (see "Server half" below).

## The client manifest (`ChatPlugin`)

Defined in [`chat/platform/types.ts`](../src/dashboard/lib/chat/platform/types.ts).
A manifest is **global pure data** — registries are instantiated per KodyChat
mount (ChatRailShell mounts the chat twice: desktop rail + mobile sheet), so
manifests must hold no mutable state.

```ts
export interface ChatPlugin {
  id: string; // unique per registry
  capabilities: readonly ChatCapability[]; // must cover contributions AND ⊆ grant
  slots?: readonly ChatSlotContribution[]; // needs "slots"
  middleware?: readonly ChatSendMiddleware[]; // needs "middleware"
  sessionState?: readonly ChatSessionStateSpec[]; // needs "session-state"
  displayModes?: readonly ChatDisplayMode[]; // needs "display-modes"
  theme?: ChatThemeContribution; // needs "theme"
  agents?: readonly string[]; // needs "agents"
  messages?: Readonly<Record<string, string>>; // i18n, namespaced plugin.<id>.<key>
}
```

### Capabilities and grants

[`chat/platform/capabilities.ts`](../src/dashboard/lib/chat/platform/capabilities.ts)
defines the eight capabilities: `slots`, `tools`, `middleware`, `theme`,
`agents`, `display-modes`, `session-state`, `host-effects`. A plugin
**declares** what it needs; the surface **grants** a set at registration.
[`registry.register(plugin, grant)`](../src/dashboard/lib/chat/platform/registry.ts)
throws `ChatPluginRegistrationError` when:

- the plugin id is already registered;
- a contribution field is present without its capability declared
  (e.g. `slots` without `"slots"`);
- any declared capability is outside the grant.

`tools` and `host-effects` have no client-manifest field (tools live in the
server half; host effects are dispatched through the middleware context), so
for those two the declaration itself is what the grant gates. Enforcement is
unit-tested per capability in
[`tests/unit/chat-platform/registry.spec.ts`](../tests/unit/chat-platform/registry.spec.ts).

### Slots

`ChatSlotId`: `header-actions`, `composer-actions`, `composer-leading`,
`message-renderer` (declared, mount pending), `footer`. The surface renders
them through `ChatPluginSlot` in
[`chat/surface/ChatPluginProvider.tsx`](../src/dashboard/lib/chat/surface/ChatPluginProvider.tsx):
zero contributions → zero DOM (no wrapper element); with contributions they
render inside a `display: contents` wrapper tagged
`data-testid="chat-plugin-slot"`. Slot components receive `{ host }` — the
read-only host-context snapshot.

### Send middleware

Runs over the outgoing text before transport. Deterministic ordering:
ascending `order`, ties broken by plugin id. A result can replace the text
(`{ text }`) and/or **consume** the message (`{ consumed: true }` stops the
chain and the send). The pinned precedence today:

| order | middleware                                                                                                                 | plugin   | behavior                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| 50    | goal mention ([`goals/mention-middleware.ts`](../src/dashboard/lib/chat/plugins/goals/mention-middleware.ts))              | goals    | consumes on a known-goal mention, dispatches `goals:direct`           |
| 100   | terminal intent ([`terminal/intent-middleware.ts`](../src/dashboard/lib/chat/plugins/terminal/intent-middleware.ts))       | terminal | consumes `/terminal <intent>` , dispatches the terminal-intent effect |
| 200   | slash expansion ([`commands/expansion-middleware.ts`](../src/dashboard/lib/chat/plugins/commands/expansion-middleware.ts)) | commands | expands `/<slug> args` via `expandSlashCommand`                       |

New middleware picks an order relative to these (before/after the consuming
steps); the ordering contract is pinned by
`tests/unit/chat-plugins/terminal-middleware-order.spec.ts`.

`ChatSendMiddlewareContext` carries the two host channels:

- `host` — read-only context snapshot (e.g. `knownGoals`, `slashCommands`),
  supplied per mount by KodyChat's `pluginHost` memo;
- `dispatchHostEffect(effect)` — effect channel to the host. Effects are
  `{ kind, payload }`; the host subscribes via `registry.onHostEffect`.
  Middleware effects dispatch **synchronously** during `runSendMiddleware`,
  which KodyChat reads through a ref immediately after the chain returns
  (see the terminal-intent hand-off in
  [`KodyChat.tsx`](../src/dashboard/lib/components/KodyChat.tsx)).

### Display modes

Plugins declare exclusive display modes (`{ id, priority }`); the platform
arbitrates via `registry.resolveDisplayMode(requested, forced?)`. A host
`forced` mode always wins — that is how vibe (a **host mode**, not a plugin —
plan M2) suppresses the terminal without any plugin→plugin import. With the
terminal plugin unregistered, the mode can never resolve to `"terminal"`.

### Session state

`ChatSessionStateSpec` gives a plugin its own persisted per-session key plus
`parse`/`serialize` codec. Registration is gated by `"session-state"`; no
shipped plugin uses it yet (terminal per-session mode currently persists via
its own registry-state module).

### Theme

`ChatThemeContribution`: `name`, `accent`, `logoUrl`, `welcomeText`,
`locale`. `registry.theme()` merges all contributions — **later registration
wins per field**. The branding plugin
([`plugins/branding/index.ts`](../src/dashboard/lib/chat/plugins/branding/index.ts))
is a factory: `createBrandingPlugin(brand)` maps a `ClientBrand`
([`lib/client-brand.ts`](../src/dashboard/lib/client-brand.ts)) to a
theme-only plugin.

### Messages / i18n

`messages` entries are auto-namespaced as `plugin.<id>.<key>` by
`registry.messages()` and registered into the catalog
([`chat/platform/i18n.ts`](../src/dashboard/lib/chat/platform/i18n.ts)):
en-only for now, `t(key, { param })` with `{param}` substitution, fallback to
the key, key collisions throw. `directionForLocale(locale)` derives the
surface-root `dir` (per-message direction logic stays independent —
`getMessageDirection` in `chat/surface/MessageList.tsx`).

## Server half — plugin tools

Tools execute **server-side**; handlers must never enter the client bundle
(plan H3). The contract lives in
[`chat/platform/tools.ts`](../src/dashboard/lib/chat/platform/tools.ts), the
process-wide singleton in
[`chat/platform/server-tools.ts`](../src/dashboard/lib/chat/platform/server-tools.ts)
— which imports `"server-only"` and is intentionally NOT exported from
`platform/index.ts`.

```ts
// my-plugin/server.ts  (imported only from server code)
import { z } from "zod";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";

getChatServerToolRegistry().register("my-plugin", (ctx) => ({
  my_tool: {
    description: "Do a thing in the connected repo",
    inputSchema: z.object({ target: z.string().min(1) }),
    execute: async (input, { owner, repo, token }) => {
      /* input is already zod-parsed by the registry wrapper */
    },
  },
}));
```

Rules, all enforced in code:

- **Zod schema required per tool** — `collect()` wraps every `execute` so
  input is `inputSchema.parse`d before the handler runs (async, so schema
  failures surface as rejections).
- **Name collisions throw** — plugin↔plugin collisions at `collect()` time
  (`ChatToolRegistrationError`); plugin↔built-in collisions are rejected by
  the kody route with a 500 (`chat_plugin_tool_collision`) — fail loudly,
  never silently override. One `register` per plugin id.
- Tools are materialized **per request** via `collect(ctx)` with
  `ChatToolServerContext` (`owner`, `repo`, `token`, `extras?`); repo-less
  requests skip plugin tools entirely.
- Integration point: the in-process kody route
  ([`app/api/kody/chat/kody/route.ts`](../app/api/kody/chat/kody/route.ts))
  merges collected tools on top of its built-in map.
- **Backend scope:** the in-process `kody` backend merges plugin tools
  directly (phase 1). The engine (`kody-live`) bridge exists since phase 2
  step 1 via **MCP config** — see below. Brain tools remain an out-of-repo
  protocol change (still out of scope).

Int coverage: `tests/int/chat-platform-plugin.int.spec.ts` (fixture plugin,
client + server halves) and `tests/int/chat-kody-direct.int.spec.ts` (real
route handler).

### Engine bridge (phase 2 step 1) — what's wired vs manual

Dashboard-side only; no engine code, no workflow YAML changes.

- **Wired — MCP endpoint:**
  [`app/api/kody/chat/plugin-tools/mcp/route.ts`](../app/api/kody/chat/plugin-tools/mcp/route.ts)
  serves the server tool registry over MCP Streamable HTTP (same protocol
  handling as the CMS precedent `app/api/kody/cms/mcp/route.ts`): initialize,
  ping, tools/list (zod → JSON Schema via zod v4 `z.toJSONSchema`),
  tools/call (zod-validated, `-32602` on invalid args). Auth is a
  repo-scoped bearer `owner/repo:hmac` — HMAC of the scope with
  `KODY_MASTER_KEY`, purpose-prefixed `kody-plugin-tools:` (chat-token
  pattern, no new env var). Tool calls run with a ctx built from the
  **verified** scope + the server-side `GITHUB_TOKEN`.
- **Wired — config/token helpers:**
  [`plugin-tools-config.ts`](../src/dashboard/lib/chat/platform/plugin-tools-config.ts)
  mints/verifies the bearer and builds the engine-shaped
  `claudeCode.mcpServers` entry (`{ name: "kody-plugin-tools", command:
"npx", args: ["-y", "mcp-remote", <endpoint>, "--header", …] }` — the
  engine spawns stdio MCP servers, so the HTTP endpoint rides the standard
  `mcp-remote` shim). The entry drops into any capability/duty profile via
  the existing Capabilities flow, which auto-derives the
  `mcp__kody-plugin-tools` allowlist token.
- **Wired — fail-open trigger rider:** when at least one plugin has
  registered server tools, the chat trigger route appends a `pluginTools`
  bearer to the `dashboardUrl` workflow input (engines ignore unknown query
  params today; a future engine can self-configure from it). With zero
  registered plugins the dispatch payload is **byte-identical** to the
  pre-bridge behavior — pinned by
  `tests/int/chat-plugin-tools-failopen.int.spec.ts`.
- **Manual:** writing the `mcpServers` entry into a consumer repo's
  capability/duty profile is an explicit operator action (Capabilities UI /
  Tools flow) — the dashboard never silently rewrites consumer repo configs.
  Note the engine's **chat** loop does not read `claudeCode.mcpServers` yet
  (only profile-driven capabilities/duties do), so chat-turn consumption
  additionally awaits engine support; the endpoint, token, and config entry
  are ready for it.

## Host wiring — registering plugins on a surface

KodyChat owns only the mechanics: it creates **one registry per mount** in a
`useState` initializer and registers the host-passed list once (mount-time
config, never re-registered on re-render):

```tsx
<KodyChat plugins={[{ plugin: myPlugin }]} capabilityGrant={MY_GRANT} />
```

- Omitted `capabilityGrant` defaults to `FULL_GRANT` (all eight capabilities).
- Registration order = array order (theme/slot merge order); middleware
  ordering is registry-sorted by `order` regardless.
- With no plugins the registry is inert: slots render nothing, the
  middleware chain passes text through — the DOM is byte-identical to a
  plugin-free build (pinned by the admin regression e2e).

**Surfaces import only their granted plugins** (per-surface plugin lists — no
global self-registering side-effect registry). Current hosts:

| Host                                                                                                                              | Plugins                         | Grant                                     |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------- |
| [`ChatRailShell.tsx`](../src/dashboard/lib/components/ChatRailShell.tsx) (desktop rail + mobile sheet — same list on both mounts) | terminal, commands, vibe, goals | `FULL_GRANT` (default)                    |
| [`GoalControl.tsx`](../src/dashboard/lib/components/GoalControl.tsx) (planner dialog)                                             | terminal, commands, vibe        | `FULL_GRANT` (default)                    |
| [`ClientChatSurface.tsx`](../src/dashboard/lib/components/ClientChatSurface.tsx) (/client/[brandSlug])                            | branding, commands              | `["theme", "middleware", "host-effects"]` |

### Bundle discipline (Step 7)

Because ClientChatSurface never passes terminal/vibe/goals, the /client
route chunk must not carry their code. Two mechanics keep that true:

1. **App code never imports the terminal barrel**
   (`plugins/terminal/index.ts` statically reaches `ChatTerminalSurface`,
   `fly-connection` and `TerminalControls`; one static path anywhere puts
   them in a shared sync chunk that /client then loads too). Hosts take the
   manifest from the leaf module
   [`plugins/terminal/plugin.ts`](../src/dashboard/lib/chat/plugins/terminal/plugin.ts);
   KodyChat deep-imports the always-needed helper leaves
   (`useChatTerminalRegistry`, `use-brain-image-save`, `checkpoints`,
   `intent-middleware`, `mode`, `registry-state`) and loads the render-gated
   components (`ChatTerminalSurface`, the three `TerminalControls`
   components) via `React.lazy` inside `<Suspense fallback={null}>`. Tests
   may import the barrel freely.
2. Hooks can never be lazy (unconditional call order), so any plugin hook a
   host calls unconditionally must live in its own leaf module with light
   imports — that is why `useBrainImageSave` is a separate file from the
   toolbar components.

## Layering rules + lint zones

Enforced as **errors** by `eslint.config.mjs` (`import/no-restricted-paths`
zones + per-layer `no-restricted-imports` alias blocks):

- `core` imports nothing from `platform`/`surface`/`plugins`/`components`.
- `platform` imports only `core`.
- `plugins/<x>` may import `platform` + `core` (+ app-wide shared modules) —
  **never a sibling plugin**.
- `surface` is not importable by `core`.
- Extra standards inside `chat/**`: `no-console: error`,
  `no-explicit-any: error`, `max-lines: 800`.

The plugin-dir list feeding the zones is the shared constant
[`src/dashboard/lib/chat/plugins/plugin-dirs.mjs`](../src/dashboard/lib/chat/plugins/plugin-dirs.mjs)
(plain `.mjs` — the eslint flat config runs under node without a TS loader).
[`tests/unit/chat-platform/plugin-dirs.spec.ts`](../tests/unit/chat-platform/plugin-dirs.spec.ts)
fails the unit gate when the list drifts from the directories actually on
disk, so **adding a plugin dir without updating the list is a red build**.

## Worked example — a minimal plugin

Client manifest (`src/dashboard/lib/chat/plugins/echo/index.ts` — and add
`"echo"` to `plugin-dirs.mjs`):

```ts
import type { ChatPlugin } from "../../platform";

export const echoChatPlugin: ChatPlugin = {
  id: "echo",
  capabilities: ["middleware", "theme"],
  middleware: [
    {
      id: "echo-expand",
      order: 150, // after terminal intent (100), before slash expansion (200)
      onSend: (text) =>
        text.startsWith("/echo ") ? { text: text.slice(6) } : null,
    },
  ],
  theme: { welcomeText: "Echo is listening." },
  messages: { hint: "Type /echo {what}" }, // → t("plugin.echo.hint", { what })
};
```

Server half (optional, server-only import path):

```ts
import { z } from "zod";
import { getChatServerToolRegistry } from "@dashboard/lib/chat/platform/server-tools";

getChatServerToolRegistry().register("echo", () => ({
  echo_read: {
    description: "Read something back",
    inputSchema: z.object({ text: z.string() }),
    execute: async (input) => input,
  },
}));
```

Host wiring — add it to the surface that should compose it, with a grant
covering `middleware` + `theme`:

```tsx
<KodyChat
  plugins={[{ plugin: echoChatPlugin }]}
  capabilityGrant={["middleware", "theme"]}
/>
```

Test layers to touch: a unit spec for the middleware (registry ordering /
consume behavior), an int spec if it has a server half (fixture pattern in
`tests/int/chat-platform-plugin.int.spec.ts`), and a Playwright assertion if
it contributes slots (vitest is node-only — nothing that renders React is
asserted in vitest).

## State ownership map

Who owns what (phase-1 end state — update when phase 1.6 moves a row):

| State | Owner | Persistence |
| ----- | ----- | ----------- |
| Sessions (list, active id, per-session agent) | `chat/core/use-chat-sessions.ts` | `kody-sessions-v3:<owner>/<repo>` |
| Live-runner lifecycle (booting/ready/awaiting) | reducer `chat/core/kody-chat-reducer.ts`, orchestrated by KodyChat | `kody-live-sessions:<owner>/<repo>` via `chat/core/kody-chat-live-session.ts` |
| Rehydration ordering | `chat/core/rehydration.ts` (pure), effects in KodyChat | — |
| Messages / streaming buffers | per-turn handler `components/kody-chat-transport-events.ts`, state in KodyChat | in the session store |
| Plugin registry (slots, middleware, modes, theme) | per-mount, created by KodyChat from host-supplied lists | — |
| Display mode (ai/terminal) | registry arbitration; vibe forces "ai" (host mode by decision M2) | terminal plugin session state |
| Composer input, slash/mention menus, attachments | KodyChat (host), rendered by `chat/surface/Composer` | — |
| composerInjection / previewContext | ChatRailShell (frozen `ChatRailApi` contract) | — |
| Agent/model selection, reasoning effort | KodyChat (phase 1.6: extract) | `kody-default-chat-entry:<owner>/<repo>`, reasoning-pref |
| Data loading (models, dashboard config, Fly probe) | KodyChat (phase 1.6: extract) | — |
| Voice | KodyChat + `useKodyTTS*` hooks (phase 1.6: extract) | — |
| Brand/theme on /client | `plugins/branding` via `registry.theme()` | brand config in `client-brand.ts` |
