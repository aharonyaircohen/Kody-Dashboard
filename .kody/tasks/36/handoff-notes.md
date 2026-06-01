# Fix Page Title Duplication (Task 36)

## What was done

Fixed the browser tab title duplication issue where pages showed titles like "Inbox — Kody Operations Dashboard | Kody Operations" instead of "Inbox | Kody Operations Dashboard".

## Changes

1. **Root layout template** (`app/layout.tsx`):
   - Changed `title.template` from `"%s | Kody Operations"` to `"%s | Kody Operations Dashboard"` to match `SITE_NAME`
   - Changed `title.default` from `"Kody Operations Dashboard"` to `"Kody"` to avoid doubling

2. **Homepage** (`app/page.tsx`):
   - Changed `title` from `"Kody Operations Dashboard"` to `"Kody"` so template produces "Kody | Kody Operations Dashboard"

3. **All child pages** (30+ pages):
   - Stripped the redundant "— Kody Operations Dashboard" suffix from page titles
   - Pages now pass just their page name (e.g., `"Inbox"`, `"Settings"`, `"Chat"`)
   - Template appends " | Kody Operations Dashboard" to produce clean titles like "Inbox | Kody Operations Dashboard"

4. **buildTaskMetadata** (`app/metadata.ts`):
   - Removed `— ${SITE_NAME}` suffix from error case titles (lines 68 and 109)
   - These would have doubled with the template

5. **Issue detail pages** (`app/[issueNumber]/**/page.tsx`):
   - Changed fallback titles from `"Kody Operations Dashboard"` to `"Kody"` for invalid issue numbers

## Verification

- TypeScript typecheck: passed
- ESLint: passed (only pre-existing warnings)
- Test suite: 1054 passed, 10 skipped

## Files modified

All page files under `app/` that used `buildKodyMetadata` with full site name in title were updated.
