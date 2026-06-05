## Fix: Browser Tab Title Duplication

### Problem

Pages showed titles like "Chat — Kody Operations Dashboard | Kody Operations" in browser tabs because:

- Layout template was `"%s | Kody Operations"`
- Page titles included the full site name (e.g., `"Chat — Kody Operations Dashboard"`)

### Changes Made

1. **`app/layout.tsx`**: Changed template from `"%s | Kody Operations"` to `"%s | Kody Operations Dashboard"` and default title from `"Kody Operations Dashboard"` to `"Kody"`

2. **`app/metadata.ts`**: Fixed `buildTaskMetadata` error/fallback paths that were appending `— ${SITE_NAME}` (causing double-suffix with the new template)

3. **39 page files**: Stripped `— Kody Operations Dashboard` suffix from titles so the template properly formats them. Pages now use short titles (e.g., `"Chat"`, `"Tasks"`) and the browser tab shows `"Chat | Kody Operations Dashboard"`

### Quality Gates

- TypeScript: PASS
- ESLint: PASS (0 errors, pre-existing warnings only)
- Tests: PASS (1096 passed, 0 failed)
- Format: FAIL — pre-existing `.kody/reports/ceo-performance-review.md` warning (not touched, outside `.kody/` scope to fix)
