# Chat backends

The dashboard chat is **three** different backends behind one composer.
Which one answers a turn is decided by the agent picked in the chat
dropdown — its `backend` field (see
[`src/dashboard/lib/agents.ts`](../../src/dashboard/lib/agents.ts)) routes
the request to one of three endpoints. A fresh composer initializes to the
`kody-live` engine agent (`lockedAgentId ?? "kody-live"`) unless the host
pins one; the in-process `kody` agent is the fastest path and the fallback
for an unresolved id.

The three backends are wildly different in latency, statefulness, and what
the agent can actually do (read vs. write code). The composer, the slash
commands, and the message history are shared; everything below the
`fetch()` call is not.

## The three backends

| Agent (`selectedAgentId`) | `backend`     | Endpoint                                                                                    | What runs                                                                       | System prompt lives in                                                                                                       |
| ------------------------- | ------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `kody`                    | `kody-direct` | [`/api/kody/chat/kody`](../../app/api/kody/chat/kody/route.ts)                               | In-process LLM stream via the Vercel AI SDK — no Actions, no VPS, no runner      | [`src/dashboard/lib/agents.ts`](../../src/dashboard/lib/agents.ts) (`AGENT_KODY.systemPrompt`)                               |
| `brain`                   | `brain`       | [`/api/kody/chat/brain`](../../app/api/kody/chat/brain/route.ts)                             | Proxy to the user's external Brain server (URL + key from Settings)             | Brain server profile (out of repo)                                                                                           |
| `brain-fly`               | `brain`       | [`/api/kody/chat/brain-fly`](../../app/api/kody/chat/brain-fly/route.ts)                     | Same proxy, but the Brain server is auto-provisioned on a per-user Fly Machine  | Brain server profile (`kody brain-serve`, out of repo)                                                                       |
| `kody-live` (**default**) / `kody-live-fly` | `kody-live` | [`/api/kody/chat/trigger`](../../app/api/kody/chat/trigger/route.ts) (+ `interactive/*`)     | GitHub Actions (or Fly) + `@kody-ade/kody-engine`; engine streams events back    | `kody2/src/chat/loop.ts` (`CHAT_SYSTEM_PROMPT`)                                                                              |

`getAgent()` / `isValidAgentId()` resolve an unknown id back to
`AGENT_KODY`, so a stale or bogus agent never hard-fails — it just lands on
the in-process `kody` agent. (That's the *unresolved-id fallback*; the
*initial* agent on a fresh composer is `kody-live` — see the FAQ.)

## Routing

```
                                  KodyChat composer
                                  selectedAgentId
                                         │
                                         ▼
                            currentAgent.backend === ?
            ┌────────────────────────────┼────────────────────────────┐
            │                            │                             │
       kody-direct                     brain                       kody-live
            │                  ┌─────────┴─────────┐                   │
            ▼                  ▼                   ▼                    ▼
   /api/kody/chat/kody   /api/kody/chat/brain  /api/kody/chat/   /api/kody/chat/trigger
   (AI SDK streamText)   (x-brain-url/-key)    brain-fly         (writes session JSONL,
            │                  │               (Fly provision)   dispatches kody.yml)
            │                  │                   │                    │
            ▼                  ▼                   ▼                    ▼
   text/UI-message      SSE proxy from        SSE proxy from     engine streams events to
   stream → bubble      Brain server          Fly Brain server   /api/kody/events/ingest
```

The branch is keyed on `currentAgent.backend`, not on the raw
`selectedAgentId` — multiple agents can share one backend (both `brain` and
`brain-fly` are `backend: "brain"`; both live agents are
`backend: "kody-live"`).

### `kody-direct` — in-process

[`/api/kody/chat/kody`](../../app/api/kody/chat/kody/route.ts) calls
`streamText` from the Vercel AI SDK and streams the reply straight back —
sub-second time-to-first-token, no cold start. Notable behavior, all
verified in the route:

- **Model resolution is per-request and user-managed.** The model comes
  from the user-curated `LLM_MODELS` list (resolved via `resolveChatModel`);
  the client may override with `body.model` but it must match an enabled
  entry. The matching API key is read from the secrets vault at request
  time (see [`../secrets-vault.md`](../secrets-vault.md)). `anthropic`
  protocol uses Claude's native Messages API (prompt caching + extended
  thinking, `budgetTokens: 5000`); everything else uses the
  OpenAI-compatible SDK.
- **Tools.** Wires `fetch_url` + feature/UI tools always, then (when a repo
  is resolved) GitHub / bug / task / goal / duty / staff / memory / release
  / pipeline / vibe tools. The model runs up to ~10 tool-calling rounds (30
  in goal-planner mode), so a single turn can do a real research loop.
- **History is trimmed** to the last `MAX_HISTORY_MESSAGES` (16) before
  hitting the model; the browser keeps the full transcript.
- **Prompt assembly.** `buildSystemPrompt` layers repo context, memory
  index, user instructions, and company profile onto `AGENT_KODY.systemPrompt`;
  `applyVoiceOverlay` is appended LAST for voice turns.
- **No server-side session** — conversation state lives in the browser and
  the request payload.

### `brain` / `brain-fly` — external Brain proxy

Both forward the turn to a Brain chat server over SSE via the shared
`streamBrainChat` core; they differ only in where the credentials come
from:

- [`/api/kody/chat/brain`](../../app/api/kody/chat/brain/route.ts) reads
  `x-brain-url` / `x-brain-key` headers (set from Settings), falling back to
  `BRAIN_CHAT_URL` / `BRAIN_CHAT_API_KEY` env. Returns **503** if neither is
  configured.
- [`/api/kody/chat/brain-fly`](../../app/api/kody/chat/brain-fly/route.ts)
  resolves a Fly token from the repo vault (`resolveFlyContext`), then
  `provisionBrain()` lazily creates (or reuses) a per-user Fly Machine and
  waits for `/healthz` (cold boot budget 240s). Returns **400** if no
  `FLY_API_TOKEN`. It also sets `plainLanguage: true` on the proxy.

Both hold the proxy open up to `maxDuration = 300` and emit a
`chat.reconnect` sentinel ~30s early so the browser resumes a long turn
cleanly. The connected repo + the user's token are forwarded so Brain can
clone a worktree. The system prompt is owned by the Brain server profile,
not this repo.

### `kody-live` / `kody-live-fly` — engine via GitHub Actions

[`/api/kody/chat/trigger`](../../app/api/kody/chat/trigger/route.ts) is the
fully async path:

1. Serializes the messages to `.kody/sessions/{taskId}.jsonl` and commits it
   to the target repo (CAS via the existing file SHA).
2. Dispatches the `kody.yml` workflow (always `kody.yml` — the
   `KODY_CHAT_WORKFLOW_ID` env is intentionally ignored) with `sessionId` +
   the last user message. The target repo defaults to the connected repo,
   overridable with `KODY_CHAT_WORKFLOW_REPO`.
3. The engine runs `kody dispatch` → chat flow, then streams events back to
   `/api/kody/events/ingest`, authenticated by an inline HMAC token appended
   to `dashboardUrl` (`mintSessionToken`, keyed on `KODY_MASTER_KEY` — no DB
   lookup). A durable `.jsonl` fallback is polled separately.

The long-lived `kody-live` agents add the `interactive/start` (+
`start-fly`) warm-up handshake on top of this, but the dispatch + event
model is the engine's. The system prompt is `CHAT_SYSTEM_PROMPT` in
`kody2/src/chat/loop.ts`, out of this repo.

## Slash commands

Slash commands (`/plan`, `/research`, `/issue`, repo `.kody/commands/*.md`,
…) work identically across all three backends: the composer expands
`/<slug>` into rendered text **before** sending, so every endpoint just
receives a normal user message. See [`../commands.md`](../commands.md).

## Deprecated endpoint

The legacy [`/api/kody/chat`](../../app/api/kody/chat/route.ts) is
deprecated. `POST` returns **410 Gone** (`GET` returns a deprecation
notice). Use one of the three routes above — for the engine path, that's
`/api/kody/chat/trigger`.

## File reference

| File                                                                                              | Purpose                                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`src/dashboard/lib/agents.ts`](../../src/dashboard/lib/agents.ts)                                | Agent registry; `backend` field drives routing; `AGENT_KODY.systemPrompt`     |
| [`src/dashboard/lib/components/KodyChat.tsx`](../../src/dashboard/lib/components/KodyChat.tsx)     | Composer; `selectedAgentId` → branch on `currentAgent.backend` → `fetch()`    |
| [`app/api/kody/chat/kody/route.ts`](../../app/api/kody/chat/kody/route.ts)                         | `kody-direct` — in-process AI SDK stream                                       |
| [`app/api/kody/chat/resolve-model.ts`](../../app/api/kody/chat/resolve-model.ts)                  | Shared model/key/SDK resolution for the in-process route                      |
| [`app/api/kody/chat/brain/route.ts`](../../app/api/kody/chat/brain/route.ts)                      | `brain` — proxy to external Brain server (headers/env creds)                  |
| [`app/api/kody/chat/brain-fly/route.ts`](../../app/api/kody/chat/brain-fly/route.ts)              | `brain` — same proxy, Brain auto-provisioned on a per-user Fly Machine        |
| [`app/api/kody/chat/trigger/route.ts`](../../app/api/kody/chat/trigger/route.ts)                  | `kody-live` — write session JSONL + dispatch `kody.yml`; engine streams back  |
| [`app/api/kody/chat/route.ts`](../../app/api/kody/chat/route.ts)                                  | Deprecated legacy endpoint — `POST` → 410                                     |

## FAQ

**Which agent is the default?**
A fresh composer initializes to `kody-live` (`backend: "kody-live"`, the
engine-via-Actions path) — `useState(lockedAgentId ?? "kody-live")` — unless
the host pins an agent via `lockedAgentId`. Separately, the in-process `kody`
(`kody-direct`) agent is the fastest option (no runner/VPS) and is where an
*unresolved* id falls back via `getAgent()`.

**What picks the backend?**
The agent's `backend` field, not the agent id directly. `brain` and
`brain-fly` both route as `backend: "brain"`; `kody-live` and
`kody-live-fly` both route as `backend: "kody-live"`.

**Where does each agent's system prompt come from?**
Only `kody-direct` agents have their prompt in this repo
(`AGENT_KODY.systemPrompt`). `brain`/`brain-fly` prompts are owned by the
Brain server profile; `kody-live` inherits the engine's `CHAT_SYSTEM_PROMPT`
(`kody2/src/chat/loop.ts`). For non-direct agents, the in-process route
falls back to `AGENT_KODY`'s prompt only when it's reached for a voice turn.

**Can voice run on any agent?**
No. Voice is a modality applied as a prompt overlay on the in-process route,
so it's gated to `supportsVoice` agents (`kody`, `brain`, `brain-fly`). A
voice turn against a non-direct agent is refused with a 400
(`voice_not_supported_for_agent`). The `kody-live` agents are
`supportsVoice: false` — too async for live TTS.

**Why does the in-process route sometimes return 409 with `fallback: "kody-live"`?**
If no model resolves or its API key is missing, the route can't answer
in-process, so it tells the client to re-route the same turn through the
GitHub Actions engine instead.

**Does the in-process chat remember prior turns server-side?**
No. There's no server session; history is resent from the browser each
request and trimmed to the last 16 messages before hitting the model.
(Brain keeps per-chat session memory; the engine reads the committed
session JSONL.)
