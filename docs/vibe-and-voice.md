# Vibe & Voice

Two ways to drive a chat turn with something other than typed text. **Vibe**
turns a running preview into the conversation — you point at a button, send a
console error, or describe a change out loud, and Kody implements it against a
live PR you can watch redeploy. **Voice** lets the same chat answer you spoken
instead of read; it's a _modality_ layered on top of whatever brain you've
selected, not a separate agent.

Both feed the **one** persistent KodyChat composer that lives in the chat rail
(see [`ChatRailShell`](../src/dashboard/lib/components/ChatRailShell.tsx)).
Vibe pushes _context_ into it (a picked element, a screenshot, a recorded
test); Voice changes how Kody _replies_ (TTS-friendly, no markdown). Neither
adds a new backend — every existing chat route just learns one extra flag.

## The pieces

| Piece                   | What it is                                                                                                                                                                  | Where                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Vibe page**           | Chat + live preview iframe + issue list. Selecting an issue swaps both chat scope and the preview URL. Route `/vibe`; chat is the rail, not a child.                       | [`VibePage.tsx`](../src/dashboard/lib/components/VibePage.tsx), [`app/vibe/page.tsx`](../app/vibe/page.tsx) |
| **Preview Inspector**   | Toolbar over the preview: pick element, console errors, failed requests, screenshot, speed check, record-a-test. Shared by Vibe and the PR Preview modal.                  | [`PreviewInspector.tsx`](../src/dashboard/lib/picker/PreviewInspector.tsx)                     |
| **Element-picker extension** | A browser extension — the preview is a cross-origin iframe the dashboard page can't reach into. Distributed as an unpacked zip, no web store.                          | [`extension/`](../extension), full guide: [./element-picker.md](./element-picker.md)           |
| **Vibe primer**         | Server-only instruction block prepended to the user's message when `vibeMode: true`. Two variants (fresh issue vs. follow-up). Iterated without republishing the engine.   | [`vibe/primer.ts`](../src/dashboard/lib/vibe/primer.ts)                                         |
| **`vibe_start_execution` tool** | Vibe-only chat tool: pre-creates the draft PR + branch _before_ handing off to the runner, so Vercel cold-builds while the runner warms up.                        | [`vibe-tools.ts`](../app/api/kody/chat/tools/vibe-tools.ts)                                     |
| **Voice overlay**       | TTS-friendly prompt rules + the `voiceMode` wire schema. Appended LAST to the assembled system prompt so its formatting rules win.                                         | [`voice/overlay.ts`](../src/dashboard/lib/voice/overlay.ts)                                     |
| **Voice hooks/UI**      | Web Speech API wrappers (speech-to-text + browser TTS), the LISTEN→PROCESS→SPEAK loop, the mic button, and the in-panel conversation overlay.                              | [`useVoiceChat`](../src/dashboard/lib/hooks/useVoiceChat.ts), [`VoiceButton`](../src/dashboard/lib/components/VoiceButton.tsx), [`VoiceChatOverlay`](../src/dashboard/lib/components/VoiceChatOverlay.tsx) |

---

## Vibe

Vibe coding is: **look at the running app, point at what's wrong, ship the
fix.** The Vibe page renders chat next to a live preview iframe; an issue list
on the side scopes both. The Preview Inspector reaches _into_ the preview to
pull live context, and the chat agent drives a draft PR directly instead of
posting `@kody …` comments.

### Pulling context out of the preview

The preview is a **cross-origin iframe**, so the dashboard's own page is
forbidden by the browser from reaching inside it. The fix is a small **browser
extension** — its content scripts _are_ allowed in. In-app injection, a proxy,
a screen stream, and a webview were all evaluated and rejected; the extension
is the only approach that works without touching the previewed app's code.
Full install/maintainer docs live in **[./element-picker.md](./element-picker.md)** —
this section only covers how a selection becomes a chat turn.

The [`PreviewInspector`](../src/dashboard/lib/picker/PreviewInspector.tsx)
toolbar exposes six actions, each driven by
[`useElementPicker`](../src/dashboard/lib/picker/useElementPicker.ts) talking to
the extension bridge over `window.postMessage`:

| Action               | What it sends                                                                                  | Lands as       |
| -------------------- | ---------------------------------------------------------------------------------------------- | -------------- |
| **Pick element**     | Click an element; its selector, tag, text, and attributes.                                     | composer chip  |
| **Console errors**   | The errors/warnings the preview has logged (with a "diagnose and fix" framing).                | composer chip  |
| **Failed requests**  | The preview's failed network calls (4xx/5xx or threw).                                          | composer chip  |
| **Screenshot**       | A PNG of the preview, cropped to the preview rect.                                              | image attachment |
| **Speed**            | Load timings (TTFB / FCP / LCP / load) plus the slowest resources.                              | composer chip  |
| **Record a test**    | Start → click through → Stop; the actions become a Playwright test the user/Kody can save.      | composer chip  |

All six are confirmed in the code. The inspector formats each capture into a
chat-ready block (see [`protocol.ts`](../src/dashboard/lib/picker/protocol.ts) —
`formatPickedElement`, `formatLogs`, `formatNetwork`, `formatPerf`,
`formatPlaywrightTest`) and emits it via two callbacks: `onContext` for a
removable composer chip, `onAttachment` for an image. The host decides where
those go.

### How a selection reaches the composer

On the Vibe page the chat **is the rail**, not a child of the page, so the
inspector can't hand a chip straight down as a prop. Instead VibePage routes
its callbacks through the rail's context API
([`useChatScope`](../src/dashboard/lib/components/ChatRailShell.tsx)):

```
PreviewInspector.onContext     → setComposerInjection(chip)   ─┐
PreviewInspector.onAttachment  → setAttachmentInjection(img)  ─┤  (ChatRailShell)
                                                                ▼
                                          KodyChat composerInjection / attachmentInjection props
                                                                ▼
                              chip appended to contextChips · image added to attachments
                                          (id-keyed so re-injection is idempotent)
```

The PR **Preview modal** ([`PreviewModal.tsx`](../src/dashboard/lib/components/PreviewModal.tsx))
embeds the same `PreviewInspector`, but because _its_ chat is a child it passes
`composerInjection` directly — the rail detour is Vibe-specific. The chip shows
a short label like `<button#submit>`; its full context block rides along with
the next outgoing message, and chip-only sends (no typed text) are allowed.

### The draft-PR-first execution flow

The Vibe chat doesn't dispatch `@kody` comments — in vibe mode those tools are
stripped (see [`vibe-tool-policy.ts`](../app/api/kody/chat/kody/vibe-tool-policy.ts)).
Instead, **the chat agent opens the draft PR itself, then hands off to the
runner.** The single vibe-only tool
[`vibe_start_execution`](../app/api/kody/chat/tools/vibe-tools.ts) does this:

1. **Get-or-create the branch** off the repo's default branch (idempotent — a
   prior branch/PR for the same issue is reused, and re-synced with base first
   so a stale branch doesn't drag in drift commits).
2. **Find-or-create the draft PR** whose body `Closes #<issue>`. Vercel starts
   **cold-building the preview now**, in parallel with the runner warmup, so
   the preview is mostly ready by the time the runner finishes editing.
3. **Auto-flip the active agent** to the chosen runner (`kody-live` or
   `kody-live-fly`) by embedding a `SwitchAgentDirective` in the tool result —
   the model can't skip the hand-off — plus an `autoKickoff` message the
   dashboard sends to the runner so the draft PR doesn't stay empty.

The runner then pushes commits onto the **branch this tool created** (it never
cuts a new one). It's told to do so by the **vibe primer** — a server-only
instruction block prepended to the user's message whenever `vibeMode: true`.
The primer lives in [`primer.ts`](../src/dashboard/lib/vibe/primer.ts), not in
the engine's `CHAT_SYSTEM_PROMPT`, so its wording can be iterated in seconds
without republishing `@kody-ade/kody-engine`. Two variants:

- **Fresh** (no task scope): research → file a GitHub issue with the plan →
  ask for confirmation → on confirm, branch + edit + PR.
- **Follow-up** (task scope present): reuse the existing vibe branch, push
  follow-up commits so the same draft PR + preview URL update.

Both carry a **hard rule**: never end a turn with uncommitted changes (the
runner's filesystem is ephemeral), and stage with pathspec exclusions
(`:!.kody/sessions` `:!.kody/events`) so the dashboard's chat transcript
doesn't leak into the PR.

One subtlety worth knowing: in the two-turn flow (turn 1 creates the issue,
turn 2 approves it) the model sometimes guesses the wrong issue number before
the task scope propagates. Two guards fix this — the tool binds to the
chat's `currentIssueNumber` when scoped, and
[`pickVibeRequestIssueNumber`](../src/dashboard/lib/vibe/recent-issue.ts) bridges
with the just-created issue for a 60s TTL until the live scope catches up.

### Vibe flow

```
┌────────────────────────────┐
│ Vibe page (/vibe)           │
│  chat ── live preview iframe│
└──────────┬─────────────────┘
           │ user points the Preview Inspector at the preview
           ▼
┌────────────────────────────┐   extension content script (cross-origin iframe)
│ Preview Inspector toolbar   │◀──────────────────────────────────────────────┐
│  pick · errors · network ·  │   window.postMessage bridge                    │
│  screenshot · speed · record│                                                │
└──────────┬─────────────────┘                                          extension/
           │ onContext / onAttachment
           ▼
┌────────────────────────────┐
│ ChatRailShell               │  setComposerInjection / setAttachmentInjection
│  (persistent KodyChat)      │  → chip + attachment on the composer
└──────────┬─────────────────┘
           │ user types intent + sends (vibeMode: true)
           ▼
┌────────────────────────────┐
│ chat agent (kody-direct)    │  vibe_start_execution:
│                             │   1. branch off default
│                             │   2. draft PR (Vercel cold-builds)
│                             │   3. SwitchAgentDirective + autoKickoff
└──────────┬─────────────────┘
           │ hands off, primer prepended server-side
           ▼
┌────────────────────────────┐
│ runner (Kody Live / Fly)    │  pushes commits onto the vibe branch
│                             │  → draft PR updates → preview redeploys
└─────────────────────────────┘
```

---

## Voice

Voice is **a modality, not an agent.** You pick the brain in the dropdown; the
same brain answers both text and voice. The dashboard signals "this turn will
be spoken" by setting `voiceMode: true` on the chat request body, and each
backend route owns how it applies the overlay.

This is browser-native and intentionally thin — there's no custom STT/TTS
service. Recognition uses the **Web Speech API**
([`useSpeechRecognition`](../src/dashboard/lib/hooks/useSpeechRecognition.ts),
`window.SpeechRecognition` / `webkitSpeechRecognition`) and playback uses
**`speechSynthesis`** ([`useKodyTTS`](../src/dashboard/lib/hooks/useKodyTTS.ts)).
That keeps the surface tiny but means voice quality and language support are
whatever the user's browser provides (Chrome's cloud recognition is best;
Firefox has no recognition).

### The conversation loop

[`useVoiceChat`](../src/dashboard/lib/hooks/useVoiceChat.ts) is a small state
machine cycling `idle → listening → processing → speaking → listening`:

1. **Listening** — STT transcribes; a 1.5 s silence window auto-segments the
   user's turn. Stop-words (`stop`, `bye`, `exit`, plus Hebrew `תודה` / `ביי` /
   `עצור`) end the conversation.
2. **Processing** — the transcript is sent through the normal `sendText` path
   with `{ voiceMode: true }` (`handleVoiceSend` in KodyChat). It reuses the
   **selected agent** — voice doesn't switch brains.
3. **Speaking** — the reply is read aloud via `speechSynthesis`, with markdown
   stripped and `<think>` reasoning blocks removed. On end it loops back to
   listening. Tapping the overlay while Kody speaks **interrupts** and starts
   listening immediately.

The UI: a mic [`VoiceButton`](../src/dashboard/lib/components/VoiceButton.tsx)
in the composer (tap = start/stop, long-press = push-to-talk) opens the
in-panel [`VoiceChatOverlay`](../src/dashboard/lib/components/VoiceChatOverlay.tsx) —
scoped to the chat panel, not full-screen — showing the live transcript,
recent turns, a mute toggle, and Esc-to-end.

### The server-side overlay

When `voiceMode` is set, [`applyVoiceOverlay`](../src/dashboard/lib/voice/overlay.ts)
appends `VOICE_OVERLAY_PROMPT` to the **fully assembled** system prompt —
appended LAST so its rules win by recency over the markdown-heavy research /
issue-creation / memory blocks. The rules reshape OUTPUT only (no markdown, no
code fences, short sentences, read symbols as words, summarize JSON/diffs/logs,
no `<think>` tags) — they never touch tools or persona.

Only the **in-process kody-direct** route applies the overlay via prompt
assembly ([`chat/kody/route.ts`](../app/api/kody/chat/kody/route.ts)); the
Brain routes ([`brain`](../app/api/kody/chat/brain/route.ts),
[`brain-fly`](../app/api/kody/chat/brain-fly/route.ts)) forward `voiceMode` to
the Brain server, which applies it server-side. The mic button is gated on
`agent.supportsVoice` ([`agents.ts`](../src/dashboard/lib/agents.ts)): **true**
for `kody`, `brain`, `brain-fly`; **false** for the `kody-live` /
`kody-live-fly` engine agents (round-trip latency through GitHub Actions makes
a spoken loop impractical). The kody route enforces this too — voice on a
non-kody-direct backend is rejected server-side.

### Voice flow

```
┌───────────────────┐  mic tap / long-press
│ VoiceButton        │──────────────┐
└───────────────────┘              ▼
                          ┌─────────────────────────────┐
                          │ useVoiceChat state machine  │
                          │  idle → listening →         │
                          │  processing → speaking →    │
                          └──────┬───────────────┬──────┘
              Web Speech STT     │               │   speechSynthesis TTS
              (browser)          ▼               ▲   (browser, markdown stripped)
                          ┌─────────────┐        │
                          │ sendText(   │────────┘
                          │  voiceMode  │  reply
                          │  : true)    │
                          └──────┬──────┘
                                 ▼
              ┌──────────────────────────────────────────┐
              │ chat route applies applyVoiceOverlay()    │
              │  kody-direct: in-process prompt assembly  │
              │  brain / brain-fly: forwarded server-side │
              └──────────────────────────────────────────┘
```

---

## File reference

| File                                                                                              | Purpose                                                          |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [`app/vibe/page.tsx`](../app/vibe/page.tsx)                                                       | Vibe route (static, AuthGuard-wrapped)                           |
| [`src/dashboard/lib/components/VibePage.tsx`](../src/dashboard/lib/components/VibePage.tsx)        | Vibe UI: chat + preview iframe + issue list; wires the inspector |
| [`src/dashboard/lib/picker/PreviewInspector.tsx`](../src/dashboard/lib/picker/PreviewInspector.tsx) | Inspector toolbar (6 actions); emits `onContext`/`onAttachment`  |
| [`src/dashboard/lib/picker/useElementPicker.ts`](../src/dashboard/lib/picker/useElementPicker.ts) | Extension bridge hook (postMessage, screenshot crop)             |
| [`src/dashboard/lib/picker/protocol.ts`](../src/dashboard/lib/picker/protocol.ts)                 | Shared message contract + chat-block formatters                  |
| [`src/dashboard/lib/components/ChatRailShell.tsx`](../src/dashboard/lib/components/ChatRailShell.tsx) | `setComposerInjection` / `setAttachmentInjection` rail API     |
| [`app/api/kody/chat/tools/vibe-tools.ts`](../app/api/kody/chat/tools/vibe-tools.ts)               | `vibe_start_execution` — draft PR + branch, then hand off        |
| [`app/api/kody/chat/kody/vibe-tool-policy.ts`](../app/api/kody/chat/kody/vibe-tool-policy.ts)     | Strips `@kody` dispatch / dup-creation tools in vibe mode        |
| [`src/dashboard/lib/vibe/primer.ts`](../src/dashboard/lib/vibe/primer.ts)                         | Server-only vibe instruction block (fresh / follow-up)           |
| [`src/dashboard/lib/vibe/recent-issue.ts`](../src/dashboard/lib/vibe/recent-issue.ts)             | Bridge the just-created issue until task scope catches up         |
| [`src/dashboard/lib/voice/overlay.ts`](../src/dashboard/lib/voice/overlay.ts)                     | Voice overlay prompt + `applyVoiceOverlay` + `voiceMode` schema  |
| [`src/dashboard/lib/hooks/useVoiceChat.ts`](../src/dashboard/lib/hooks/useVoiceChat.ts)           | LISTEN→PROCESS→SPEAK conversation state machine                  |
| [`src/dashboard/lib/hooks/useSpeechRecognition.ts`](../src/dashboard/lib/hooks/useSpeechRecognition.ts) | Web Speech API STT wrapper                                 |
| [`src/dashboard/lib/hooks/useKodyTTS.ts`](../src/dashboard/lib/hooks/useKodyTTS.ts)               | `speechSynthesis` TTS wrapper                                    |
| [`src/dashboard/lib/components/VoiceButton.tsx`](../src/dashboard/lib/components/VoiceButton.tsx) | Composer mic (tap / long-press)                                  |
| [`src/dashboard/lib/components/VoiceChatOverlay.tsx`](../src/dashboard/lib/components/VoiceChatOverlay.tsx) | In-panel voice conversation overlay                     |
| [`extension/`](../extension)                                                                      | Element-picker browser extension source (see element-picker.md)  |

## FAQ

**Why is the picker a browser extension and not in-app?**

The preview is a cross-origin iframe; the browser forbids the dashboard's own
page from reaching inside it. An extension's content scripts are allowed in
without touching the previewed app's code. In-app injection, a proxy, a stream,
and a webview were all rejected. Install + maintainer details:
[./element-picker.md](./element-picker.md).

**Does the Vibe chat post `@kody` comments to run the engine?**

No. In vibe mode the `@kody` dispatch tools are stripped. The chat agent opens
the draft PR itself via `vibe_start_execution`, then auto-switches to the
runner, which pushes onto that same branch. Posting comments would be slower
and split work across artifacts.

**Why open the draft PR before the runner even starts?**

So Vercel begins cold-building the preview in parallel with the runner warmup.
By the time the runner finishes editing, the first build is mostly done and
every subsequent push is a fast delta deploy.

**Can I use the Preview Inspector outside the Vibe page?**

Yes — the PR **Preview** modal embeds the same inspector. The only difference
is wiring: Vibe routes chips through the rail (`useChatScope`) because its chat
is the rail; the modal passes `composerInjection` directly to its child chat.

**Is voice its own agent?**

No. Voice is a modality flag (`voiceMode: true`) on the request. The selected
brain answers; the server just appends a TTS-friendly overlay to that brain's
system prompt. The mic only appears for agents with `supportsVoice: true`
(`kody`, `brain`, `brain-fly`) — the engine runners (`kody-live`,
`kody-live-fly`) hide it because the round trip is too slow for a spoken loop.

**How good is the voice quality?**

It's browser-native — Web Speech API for recognition, `speechSynthesis` for
playback — so quality, voices, and language support are whatever the user's
browser provides. There's no server-side STT/TTS. Chrome works best; Firefox
has no speech recognition, so the mic stays hidden there. The loop does handle
multilingual stop-words (English + Hebrew) and auto-detects reply language for
TTS, but it is deliberately a thin browser feature, not a polished voice
product.
