/**
 * @fileType module
 * @domain branches
 * @ai-summary Typed errors for the branches module.
 *
 *   Callers can `instanceof`-check these to render specific user-facing
 *   messages without parsing strings out of generic Error.
 */

export class ForeignBranchError extends Error {
  readonly branchName: string;
  readonly issueNumber: number;

  constructor(branchName: string, issueNumber: number) {
    super(
      `Branch '${branchName}' already exists but was not created by Kody for ` +
        `issue #${issueNumber}. Refusing to reuse — it may belong to another ` +
        "session or a human contributor. Delete the branch (or pick a different " +
        "slug) to start fresh.",
    );
    this.name = "ForeignBranchError";
    this.branchName = branchName;
    this.issueNumber = issueNumber;
  }
}

export class LockTakenError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `Another vibe session is already in progress for ${key}. ` +
        "Wait for it to finish (or auto-expire after the TTL) before " +
        "starting a new one.",
    );
    this.name = "LockTakenError";
    this.key = key;
  }
}
