/**
 * @fileType module
 * @domain branches
 * @ai-summary Public API of the branches module.
 *
 *   Consumers import from `@dashboard/lib/branches` only — never reach into
 *   `domain/`, `application/`, or `infra/` directly. This keeps the internal
 *   layout free to evolve.
 *
 *   Layers:
 *   - `domain/`       Pure logic: name derivation, policy. No I/O.
 *   - `infra/`        Octokit wrappers. The only place that talks to GitHub.
 *   - `application/`  `BranchService` orchestrates domain + infra.
 */
export {
  isProtectedBranch,
  PROTECTED_BRANCHES,
} from './domain/protected-branches'

export {
  slugifyTitle,
  buildBranchName,
  parseIssueFromBranch,
} from './domain/branch-name'

export type {
  BranchRepo,
  CompareStatus,
  MergeResult,
  CreateBranchResult,
} from './infra/github-branch-repo'

export { GitHubBranchRepo } from './infra/github-branch-repo'

export type {
  GetOrCreateInput,
  SyncResult,
  PRResult,
} from './application/branch-service'

export { BranchService } from './application/branch-service'

export { ForeignBranchError, LockTakenError } from './errors'

export type { LockPort, Lease } from './domain/lock-port'

export { GitHubFileLock } from './infra/github-file-lock'

export { isKodyMarkerCommit, isKodyOwnedBranch } from './domain/branch-ownership'
