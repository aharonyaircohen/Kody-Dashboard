/**
 * @fileType module
 * @domain previews
 * @pattern previews-index
 * @ai-summary Per-PR preview hosting on Fly Machines — replaces Vercel
 *   previews (production stays on Vercel; only previews move). Public
 *   surface re-exported below; the rest of the dashboard should import
 *   from this index, not the leaf files.
 *
 *   Entry point: `webhook.handlePrOpenedOrSynced` / `handlePrClosed`
 *   for PRs, and `webhook.handleDefaultBranchPush` for base-image
 *   refreshes. The folder is also reachable from the dashboard UI via
 *   `app/api/kody/previews/**` (status, branch, static, sweep) and
 *   `app/api/kody/fly/**` (machine inventory + actions).
 *
 *   Load-bearing gotcha — per-repo billing: every Fly call uses the
 *   TARGET repo's own `FLY_API_TOKEN` from its vault (see `config.ts`),
 *   not a global dashboard token. A repo without a token is silently
 *   skipped at every entry point, so previews are inherently opt-in.
 *   Don't thread a global `FLY_API_TOKEN` (or `FLY_IO_TOKEN`) through
 *   this folder — the per-repo rule is the contract, not an
 *   optimization, and the vault entry is the only safe place for it.
 *
 *   Secondary gotcha — deterministic naming: (repo, PR) → fixed Fly
 *   app + hostname (see `preview-key.ts`). That makes status lookups
 *   a Fly API call with no DB, and lets the warm pool swap images on
 *   the same hostname — but it also means a stale machine in the app
 *   will keep answering under the old image until `destroyPreview`
 *   runs (PR close → `handlePrClosed`).
 */

export * from "./base-rebuild";
export * from "./builder-client";
export * from "./config";
export * from "./fly-previews";
export * from "./fly-pr-preview-url";
export * from "./preview-key";
export * from "./preview-lifecycle";
export * from "./preview-pool";
export * from "./preview-router";
export * from "./static-preview";
export * from "./static-preview-client";
export * from "./sweep";
export * from "./vault-build-context";
export * from "./webhook";
