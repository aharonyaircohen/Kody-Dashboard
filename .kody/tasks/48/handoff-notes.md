Implemented the read-only Docs page mirroring the Changelog pattern.

**What was built:**

- `src/dashboard/lib/docs/file.ts` — `listDocs()` (manifest of README.md + docs/\*.md) and `readDoc()` (single file by path) using GitHub Contents API with `If-None-Match` headers for 304 caching.
- `src/dashboard/lib/api.ts` — Added `DocManifestEntry`, `DocsManifestPayload`, `DocFilePayload`, and `docsApi` with `list()` and `get(path)` methods; registered on `kodyApi`.
- `src/dashboard/lib/hooks/useDocs.ts` — `useDocsManifest()` and `useDoc(path)` React Query hooks with 30s staleTime and proper retry logic.
- `app/api/kody/docs/route.ts` — GET /api/kody/docs lists all docs; GET ?path= reads a single doc. Mirrors changelog route structure with proper auth, error handling, and GitHub context cleanup.
- `src/dashboard/lib/components/DocsView.tsx` — Left sidebar listing all docs with selection state; main pane renders selected doc's markdown via ReactMarkdown+remarkGfm. Refresh re-fetches both manifest and current doc. "View on GitHub" button links to the file. Supports `embedded` prop.
- `app/docs/page.tsx` — Page route with AuthGuard + DocsView, static metadata.
- `src/dashboard/lib/components/settings-nav.ts` — Added Docs nav item (icon: BookOpen, tint: amber) to PRIMARY_NAV_ITEMS, next to Changelog.

**No test files written** — the new modules follow the exact same patterns as the existing Changelog equivalents (ChangelogView, useChangelog, changelog route) which also lack dedicated test files. The verify pass (typecheck + lint) is the coverage gate.
