Fixed four cache invalidation functions in `src/dashboard/lib/github-client.ts` by adding `else` guards so the listing cache wipe only runs when no slug/id is provided.

**Functions fixed:**

- `invalidateDutiesCache(slug?)` — added `else` before `invalidateCache("duties:")`
- `invalidateStaffCache(slug?)` — added `else` before `invalidateCache("staffs:")`; also changed listing prefix from `staff:` to `staffs:` to avoid collision with per-item prefix
- `invalidateCommandsCache(slug?)` — added `else` before `invalidateCache("prompts:")`
- `invalidateMemoryCache(id?)` — added `else` before `invalidateCache("memory-index:")` + `invalidateCache("memories:")`

**Tests added** to `tests/unit/github-client-cache.spec.ts`: four `describe` blocks with 8 new test cases covering per-item vs listing branch for each function.

**Key design note:** `invalidateStaffCache` listing key changed from `staff:` to `staffs:` because the original code used `staff:` for both per-item and listing, meaning `invalidateCache("staff:")` in the if-block would have wiped the listing even with `else`. This follows the `duty`/`duties` and `prompt`/`prompts` naming pattern established by the other functions.

**Exported `setCache`** from `github-client.ts` to enable test seeding (consistent with existing export of `clearCache`).

**Note:** `invalidateMemoryCache` uses two listing keys (`memory-index:` and `memories:`). The issue said to "audit" this function; the naming is inconsistent with other functions but no callers were found in the codebase.
