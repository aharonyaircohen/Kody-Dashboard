# PR #324 conflict resolution

Resolved two conflicts in `src/dashboard/lib/components/KodyChat.tsx` and one in `tests/unit/duty-creation-guide.spec.ts` between PR #324 (`321-show-tool-descriptions-in-kody-chat-thinking-panel`) and `origin/main`.

**KodyChat.tsx conflict 1 (line 4632)**: The auto-merge mistakenly placed main's per-session agent pick onClick code inside the reasoning-level button's onClick. The agent pick code (which uses `a.agentId` / `a.modelId`) belongs in the agent-pick dropdown item button, NOT the reasoning-level button. Resolution: kept the reasoning-level button's behavior (`setReasoningMenuOpen((v) => !v); setAgentMenuOpen(false);`) and applied the per-session agent onClick separately to the agent-pick button.

**KodyChat.tsx conflict 2 (line 4805)**: New-conversation button. Took main's `agentKey` seeding logic, preserved HEAD's indentation (14 spaces, matching the surrounding `<div>`).

**Auto-merge incompleteness (no marker)**: The per-session agent commit (d3b4ced5) modified the agent-pick onClick to use `setSessionAgent` instead of `writeDefaultChatEntry`, but the auto-merge added the new `useEffect` while leaving the existing `writeDefaultChatEntry(a.key)` line untouched. `kody-chat-per-session-agent.spec.ts` failed until I replaced the line.

**duty-creation-guide.spec.ts**: Took main's version — the chat-defaults bundle's `create-duty` skill is the new home for the `staff`/`runner`/`config.staff` documentation; the legacy `AGENT_SOURCE` reference was removed when the agent prompt moved into the bundle.

All 1516 tests pass, typecheck clean, lint clean.
