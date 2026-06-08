# Issue #146 — Browser tab shows site name twice on /

## What

`app/page.tsx` set `metadata.title = "Kody Operations Dashboard"`, the
same string as the layout's `title.default`. With the layout's
`title.template = "%s | Kody Operations"`, the rendered browser tab on
`/` was `"Kody Operations Dashboard | Kody Operations"` — the site
name in full plus a shorter redundant variant. (An older state of the
template produced exact-word duplication; the issue body describes that
state, but the redundancy remains with the current shorter template.)

## Fix

Minimal, one-line change in `app/page.tsx`: the home page title is now
`"Happening now"`. With the current template, the rendered tab is
`"Happening now | Kody Operations"` — site name once, page-specific
prefix, no duplication.

## Files

- `app/page.tsx` — `buildKodyMetadata({ title: "Happening now", ... })`
  (line 21). Matches the convention every other page in the app router
  already uses: page-specific name as the title, site name rendered
  once via the layout's template suffix.
- `tests/unit/page-home-title.spec.ts` — new structural test
  (mirrors the `tests/unit/chat/chat-header-icon-only.spec.ts`
  pattern). Four assertions:
  1. layout exports `default` + `template` (sanity).
  2. **home page title is not the full site name** — this is the bug.
  3. rendered tab title on `/` contains `"Kody Operations Dashboard"`
     at most once (defense-in-depth against template regression).
  4. `metadata.ts` `SITE_NAME` matches the layout's `title.default`
     (keeps OG/Twitter cards aligned with the title).

## Verification

- Repro test went red on assertion #2 before the fix
  (`expected 'Kody Operations Dashboard' not to be 'Kody Operations
  Dashboard'`), green after.
- Full unit + integration suite: 1293 passed / 10 skipped.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.
- Other pages (`/tasks`, `/vibe`, `/<n>`, etc.) already use
  page-specific titles — manual audit confirmed no other page has the
  full site name as its title (the [issueNumber] fallback in
  `generateMetadata` returns the full site name for non-numeric
  segments, but the page handler returns 404 in that branch so the tab
  never shows it; flagged in followups).
