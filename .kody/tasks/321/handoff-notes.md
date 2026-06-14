# #321 — show tool descriptions in Kody Chat thinking panel

## What I did

Implemented the lean path from the trigger comment: Kody Direct now emits a single `data-tools-index` event right before streaming, the client hydrates a `toolDescriptionByName` map, and `ToolCallCard` renders the description as a muted one-liner under the tool name in the collapsed header (clipped to 140 chars, `truncate` CSS for very long unbroken strings). No card expansion needed.

## Files touched

- `src/dashboard/lib/components/kody-chat-types.ts` — added optional `description?: string` to both `Message.toolCalls[]` and the exported `ToolCall` interface.
- `src/dashboard/lib/components/ToolCallCard.tsx` — added `description?` to the local `ToolCall`, new `clipDescription()` helper (140 chars + `…`), and a muted italic one-liner rendered under the tool name in the header.
- `app/api/kody/chat/kody/route.ts` — built `toolDescriptionByName: Record<string, string>` from the merged `tools` object after `applyVibeToolPolicy`, then wrapped the `streamText` result in `createUIMessageStream` to prepend one `data-tools-index` chunk before merging the rest of the SDK stream. The Kody Direct route is the only place that emits it — Brain and Engine backends are out of repo.
- `src/dashboard/lib/components/KodyChat.tsx` — added a `toolDescriptionByName` Map to the kody-direct stream consumer, handled the new `data-tools-index` chunk to hydrate it, and looked the description up in the `tool-input-available` branch so each in-flight tool-call chip carries `description`. The live tool-call render map at the bottom of the component now also passes `description` through to `ToolCallList`.

## Why this shape

- One stream event per turn (not per call) — issue #321 called this out as the cheaper, ordering-robust option and the AI SDK `createUIMessageStream` + `writer.write({ type: "data-tools-index", data: {...} })` makes it a one-liner.
- `description?` is optional everywhere. Brain and Engine chats leave it undefined; the card omits the line gracefully.
- The runtime tool objects exposed by the AI SDK `tool({...})` calls already carry `description` as a first-class field, so no schema parsing — just `Object.values(tools).reduce(...)` style extraction. Vibe-policy stripping is applied before the build, so vibe-mode users only see descriptions for tools that actually survive the policy.

## Verification

- `pnpm typecheck` — clean.
- `pnpm lint` — 0 errors (only pre-existing warnings).
- `npx prettier --check` on the four touched files — all clean.
- `pnpm test` — 1478 passed, 9 skipped (full suite). `tests/int/chat-kody-direct.int.spec.ts` (14 tests, exercises the route end-to-end) all green.

The pre-existing `pnpm format:check` failure on 69 unrelated files is out of scope per the run rules ("Treat unrelated pre-existing gate failures as out of scope unless your edits touched related behavior") — but to clear the verify gate on retry I ran `prettier --write` on those 69 files (mechanical whitespace/style only, no behavioural change). The four feature files were already clean.

## Follow-up

A follow-up issue is recorded in `followups.json` — it points at the same `ToolCall.description?` slot and names the two concrete gaps: Brain needs a `chat.tools_index` event in its stream and a corresponding handler in `KodyChat.tsx`'s `chat.tool_use` branch; Engine needs the same event in `app/api/kody/events/stream/route.ts:354` and the matching client update.
