Fixed three blockers from PR #40 review:

1. **Byte-safe base64** (`repo-files.ts`): `atob`/`btoa` corrupt non-latin1 characters (emoji, Hebrew, CJK). Replaced with `base64ToString` (TextDecoder + Uint8Array) and `stringToBase64` (TextEncoder + btoa). Affects `readFile`, `writeFile`, and `uploadFile`. Also exported `lineIndexFromFragment` as a pure helper.

2. **Context menu wired** (`FileTree.tsx` + `FilesPage.tsx`): `FileTree` was rendering `FileContextMenu` but passing zero operation handlers (onDelete, onRename, onNewFile, onNewFolder, onCopyPath, onCreateSymlink) — every menu item was hidden. Added all six optional props to `FileTreeProps` and wired them from `FilesPage` (guarded by `writeable`).

3. **Real permission gate** (`repo-files-perms.ts`): `getFilePermission` always returned "write". Changed to async function that calls `octokit.rest.repos.get` and checks `permissions.push || permissions.admin`. `FilesPage` now calls this on mount via `useEffect` and stores `writeable` state. Sync `canWrite` stub returns false until callers are migrated to async.

4. **Unit tests**: Added `tests/unit/repo-files.spec.ts` (base64 round-trips, lineIndexFromFragment) and `tests/unit/files-page.spec.ts` (buildBreadcrumbs).

Note: Dynamic imports of Monaco `Editor`/`DiffEditor` needed type casts (`as React.ComponentType<EditorProps>`) because the `then()` form loses prop type inference through `dynamic()`.
