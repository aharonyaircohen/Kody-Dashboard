# Task 31 — Browser Tab Title Duplication Fix

## What was done

Fixed browser tab title duplication by aligning the page title template with individual page titles.

**Root cause:** Pages used titles like `"Tasks — Kody Operations Dashboard"` while the layout template was `"%s | Kody Operations"`, producing wrong browser tab titles like `"Tasks — Kody Operations Dashboard | Kody Operations"`.

**Fix applied:**

1. `app/layout.tsx` — Changed `default: "Kody Operations Dashboard"` → `"Kody"` and `template: "%s | Kody Operations"` → `"%s | Kody Operations Dashboard"`
2. `app/metadata.ts` — Removed ` — ${SITE_NAME}` from `buildTaskMetadata` error/not-found paths so they now produce clean titles like `"Task #123"` → rendered as `"Task #123 | Kody Operations Dashboard"`
3. ~38 page files — Stripped ` — Kody Operations Dashboard` suffix from `buildKodyMetadata({ title: "..." })` calls

## Files changed

- `app/layout.tsx` — template and default title
- `app/metadata.ts` — error path titles
- `app/page.tsx`, `app/tasks/page.tsx`, `app/chat/page.tsx`, `app/duties/page.tsx`, `app/activity/page.tsx`, `app/new/page.tsx`, `app/bug/page.tsx`, `app/changelog/page.tsx`, `app/report-kody-bug/page.tsx`, `app/staff/page.tsx` — top-level pages
- `app/(chat-rail)/*/page.tsx` — all chat-rail pages
- `app/[issueNumber]*/page.tsx` — issue detail pages (isNaN fallback: `"Kody"`)

## Result

- Root `/` → `"Kody | Kody Operations Dashboard"`
- Tasks → `"Tasks | Kody Operations Dashboard"`
- Task #123 → `"#123 My Issue Title | Kody Operations Dashboard"`
