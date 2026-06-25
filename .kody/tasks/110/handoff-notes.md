# Preview positioning fix (issue #110)

**Bug:** Clicking "Preview" on a task opened a `fixed inset-0 z-50` overlay that covered the sidebar and the persistent chat rail. Expected: preview opens as an in-page panel, all three (sidebar | chat rail | preview) visible at once.

**Root cause:** `PreviewModal` was implemented as a full-screen overlay by design — it mounted its own inner `<KodyChat>` panel because the modal's `fixed` positioning hid the chat rail. That made the modal a *modality* rather than a view.

**Fix:** Switched the modal's outer container to in-flow (`flex flex-col h-full w-full`) and removed the inner chat panel + resize handle, since `ChatRailShell` already mounts the chat rail and pushes the task context into it. The modal now sits next to the rail in the page's main column. Also fixed the no-PR empty state the same way.

**Files changed:**
- `src/dashboard/lib/components/PreviewModal.tsx` — outer container in-flow; removed inner KodyChat + resize helpers (state, callbacks, dead code) and the related `KodyChat` import; updated the `ai-summary` docblock.
- `tests/unit/preview-modal-positioning.spec.ts` (new) — source-level structural test (mirroring the `kody-chat-composer.spec.ts` pattern) that asserts: outer container is not `fixed`/`inset-0`; outer container is `flex flex-col h-full w-full`; main render does not mount a duplicate `<KodyChat>`.

**Verification:** `kody-verify` passes (typecheck, lint, full test suite, including the new test). The new test failed before the fix and passes after.

**Scope note:** Did NOT touch `ChatRailShell`, `KodyDashboard`, the routing helpers, or the per-task `kody.chatPanelWidth` localStorage key (no other component reads it). The standalone `/preview` route and `PreviewWorkspace` are unchanged.
