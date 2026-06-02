## What

Implemented a fully-featured file browser and editor at `/files` for the Kody Dashboard. GitHub issue #26.

## How

The `/files` route is a three-panel layout: file tree on the left, viewer/editor/diff on the right, with a search overlay. All operations use the user's GitHub token via Octokit so permissions match their GitHub access.

**New files:**

- `src/dashboard/lib/repo-files.ts` — GitHub Contents API wrapper (listDir, readFile, writeFile, deleteFile, moveFile, createSymlink, uploadFile, searchCode, commitsForPath)
- `src/dashboard/lib/repo-files-perms.ts` — Permission guards
- `src/dashboard/lib/repo-files-icons.tsx` — File extension → lucide icon mapping
- `src/dashboard/lib/repo-files-lang.ts` — File extension → Monaco language ID mapping
- `src/dashboard/components/files/FileTree.tsx` — Lazy hierarchical file tree with sort (name/size/date), right-click context menu
- `src/dashboard/components/files/FileContextMenu.tsx` — New File/Folder, Rename, Delete, Copy Path, New Symlink
- `src/dashboard/components/files/FileViewer.tsx` — Read-only Monaco viewer with metadata bar
- `src/dashboard/components/files/FileEditor.tsx` — Editable Monaco with edit/preview/split modes for markdown, Ctrl+S save
- `src/dashboard/components/files/MarkdownPreview.tsx` — ReactMarkdown + remarkGfm renderer
- `src/dashboard/components/files/FileDiffViewer.tsx` — Monaco DiffEditor for commit comparisons
- `src/dashboard/components/files/FileSearch.tsx` — Full-text search with 300ms debounce
- `src/dashboard/components/files/CommitMessageDialog.tsx` — Radix Dialog for commit messages
- `src/dashboard/components/files/UploadZone.tsx` — Drag-and-drop upload zone
- `src/dashboard/components/files/FilesPage.tsx` — Main orchestrator combining all sub-components
- `app/files/page.tsx` — Route entry
- `src/dashboard/lib/components/settings-nav.ts` — Added Files nav item to settings sidebar

## Why

Users requested direct file browsing and editing without leaving the dashboard.

## Notes

- Only `@monaco-editor/react` was added as a dependency; `react-markdown`, `remark-gfm`, `@dnd-kit/core`, `sonner` were already present
- DiffEditor imported via `dynamic(() => import("@monaco-editor/react").then(mod => ({ default: mod.DiffEditor })))` — do not use `mod.MonacoDiffEditor`
- GitHub Search API `text_matches` indices are `number[]` not `[number, number]` tuples — type assertion required
