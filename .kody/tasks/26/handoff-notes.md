## Issue #26 — Fully-featured File Browser at /files

Implemented a complete file browser and editor at `/files` for the Kody Dashboard.

### Architecture

- **Page**: `app/files/page.tsx` — `AuthGuard` + `FilesManager`
- **Orchestrator**: `src/dashboard/lib/components/FilesManager.tsx` — toolbar, layout, mode switching
- **Context**: `src/dashboard/lib/components/files/FilesContext.tsx` — shared state (branch, path, file, view mode, sort, search, unsaved changes)
- **Components**: `FileTree`, `FileViewer`, `FileEditor`, `FileDiffViewer`, `MarkdownPreview`, `FileSearch`, `UploadZone`, `FileContextMenu`
- **Utilities**: `repo-files.ts` (API client), `repo-files-icons.tsx` (file type icons), `repo-files-lang.ts` (Monaco language detection), `repo-files-perms.ts` (read/write guards)
- **API routes**: `app/api/kody/files/{contents,route,search,branches,commits,diff}`

### Key fixes applied during verify

- `MonacoDiffEditor` → use `DiffEditor` from `@monaco-editor/react` (correct export name)
- `showCommitPicker` state must be `string | null` not `boolean`
- `buildHeaders` was not exported from `api.ts` — inlined locally in `repo-files.ts`
- `PlusFolder` does not exist in lucide-react — use `FolderPlus`
- `react-resizable-panels` exports `Group`/`Panel`/`Separator`, not `PanelGroup`/`Panel`/`PanelResizeHandle`
- Import paths in files components use `@dashboard/lib/` alias, not relative `../repo-files`
- All duplicate object keys removed from `repo-files-lang.ts` and `repo-files-icons.tsx`
- `text_matches` from GitHub API uses optional fields — normalized before returning

### Pending followups

1. New File/New Folder toolbar buttons are stubs (see followups.json)
2. Split view uses manual div layout; could use react-resizable-panels for true resizable panels
