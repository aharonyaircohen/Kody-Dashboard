/**
 * @fileType module
 * @domain branches
 * @ai-summary Single source of truth for branches that must never be
 *   deleted via the dashboard.
 *
 *   Replaces five ad-hoc `branch === 'main' || branch === 'master'`
 *   checks previously scattered across /api/kody/branches,
 *   /api/kody/tasks/approve, /api/kody/tasks/approve-review, and
 *   github-client.deleteBranch — three of which had divergent lists
 *   (e.g. /api/kody/branches did NOT guard `dev`, so a request like
 *   `DELETE /api/kody/branches {"branch":"dev"}` would happily delete
 *   the default branch on repos that use `dev`).
 *
 *   Every branch-deletion site must funnel through `isProtectedBranch`
 *   before calling `octokit.git.deleteRef`.
 */
import { DEV_BRANCH, PROD_BRANCH } from '@dashboard/lib/constants'

export const PROTECTED_BRANCHES: ReadonlySet<string> = new Set([
  PROD_BRANCH, // 'main'
  DEV_BRANCH, // 'dev'
  'master',
])

export function isProtectedBranch(name: string): boolean {
  return PROTECTED_BRANCHES.has(name.toLowerCase())
}
