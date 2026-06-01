## Fix: Page title duplication in browser tab

**Root cause:** The root layout had `template: "%s | Kody Operations"` but pages set full titles like `"Tasks — Kody Operations Dashboard"`. This produced `"Tasks — Kody Operations Dashboard | Kody Operations"` — the site name was duplicated.

**Changes made:**

1. **`app/layout.tsx`**: Changed title template from `"%s | Kody Operations"` to `"%s | Kody Operations Dashboard"` to match the full site name.

2. **`app/page.tsx`**: Removed explicit metadata export — the page now uses the layout default `"Kody Operations Dashboard"` directly (no template applied).

3. **32 page files**: Updated to use page-specific titles only (e.g., `"Tasks"` instead of `"Tasks — Kody Operations Dashboard"`), allowing the template to properly format them as `"Tasks | Kody Operations Dashboard"`.

4. **6 issue pages** (`app/[issueNumber]*/page.tsx`): Changed error-state title returns from `{ title: "Kody Operations Dashboard" }` to `{ title: { absolute: "Kody Operations Dashboard" } }` to bypass the template and avoid `"Kody Operations Dashboard | Kody Operations Dashboard"` duplication.

**Verification:**

- Typecheck: PASSED
- Lint: PASSED (pre-existing warnings in unrelated files)
- Tests: 1056 passed, 10 skipped
- Format: 40 pre-existing failures in unrelated files (tools, builder, docs, components, tests). All 6 issue pages I touched were formatted by Prettier.
