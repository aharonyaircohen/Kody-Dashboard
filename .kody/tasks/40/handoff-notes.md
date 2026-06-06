Second fix round on PR #40 (the first round only resolved merge conflicts; this round fixes the /files file-tree bug that the live preview was still showing).

**Bug.** Every folder on `/files` rendered as empty. Root cause was in `src/dashboard/components/files/FileTree.tsx`'s inline `buildTree` (a `useCallback`): the function set `children` to `null` when an entry's children had been loaded, and to `[]` otherwise, but it **never recursed** to build the nested `TreeNode[]`s. The render guard `isOpen && node.children !== null && node.children.map(...)` then never ran the `.map`, so a folder whose children were fetched still rendered with `children: null` and no subtree.

**Fix (all in `src/dashboard/components/files/FileTree.tsx`):**

1. **Extracted `buildTree` from the component into a top-level exported function** so the regression test can call it directly. New signature: `(entries, childrenMap, openPaths, loadingPaths, sortKey) => TreeNode[]`. The caller now threads whether it's the root (the useQuery data) or a child (recursive call) explicitly — no more `children = childrenMap[path] ?? entries` swallow at the top.
2. **Made it recurse on open directories:** `children: entry.type === "dir" && openPaths.has(entry.path) ? buildTree(childrenMap[entry.path] ?? [], childrenMap, openPaths, loadingPaths, sortKey) : null`. For files and closed dirs, `children` is `null` (render guard skips them); for an open dir whose children haven't been fetched yet, the recursion passes `[]` (so the row renders and the existing `isLoading` spinner shows); for a fetched open dir, the recursion builds the nested `TreeNode[]`.
3. **Changed the render guard to `node.children?.map(...)`** in `TreeNodeRow` — closed folders and files now render nothing naturally, and the empty-array case (loading) renders an empty list, so the spinner is the only visible affordance.

**Regression test** at `tests/unit/file-tree.spec.ts` exercises:

- The exact case from the live preview: `app` is open, `childrenMap.app` contains `app/page.tsx` (file) and `app/api` (dir). Asserts the returned tree has a root node for `app` with a non-null `children` array of length 2 containing both `app/api` and `app/page.tsx` (dirs first, then files), each with `children: null` (closed dir / file). This catches any future regression to the swallow/null pattern.
- Files → `children: null`.
- Closed directories (cached or not) → `children: null`.
- Open dir with no cached children → `children: []` (so the spinner shows) and `isLoading: true`.
- Sort order is dirs-first, then alpha.

**Verification.** `mcp__kody-verify__verify` returns `ok: true` (typecheck/lint/format/tests). All 5 new tests pass.

**Side effect of the worktree.** `pnpm install --frozen-lockfile` was needed once to populate `@monaco-editor/react` (declared in this PR's `package.json` + `pnpm-lock.yaml`, but `node_modules/` was stale on the worktree). The install only adds the 7 new packages from the lockfile — no spec drift. The typecheck failure was pre-existing on the branch, not introduced by this round.
