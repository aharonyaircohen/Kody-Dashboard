/**
 * @fileType library
 * @domain brain
 * @pattern repo-brain-scope
 *
 * @ai-summary Repo-scoped Brain conversation identity. The Brain Fly
 *   machine itself is user-owned and persists across repos, but every chat
 *   turn MUST carry a `RepoBrainScope` so Brain clones, persists, and
 *   resumes the right repo workspace. The key is `${owner}/${repo}` —
 *   fall back to `"norepo"` only when the caller truly has no repo (which
 *   means no clone/persist). Trap: missing the scope collapses unrelated
 *   sessions into one workspace. API routes that hit Brain must derive
 *   the scope from the request (path params for `/chat/...` and
 *   `/terminal/...`) and pass it through; never let the default
 *   `"norepo"` be a silent default at the route layer.
 */

export interface RepoBrainScope {
  type: "repo";
  owner: string;
  repo: string;
  repoSlug: string;
  key: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

export interface RepoBrainScopeInput {
  owner?: string | null;
  repo?: string | null;
  storeRepoUrl?: string | null;
  storeRef?: string | null;
}

export type RepoBrainConversationTarget =
  | { type: "task"; id: number | string }
  | { type: "capability"; slug: string }
  | { type: "global"; sessionId: string };

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function repoBrainScopeKey(input?: RepoBrainScopeInput | null): string {
  const owner = clean(input?.owner).toLowerCase();
  const repo = clean(input?.repo).toLowerCase();
  return owner && repo ? `${owner}/${repo}` : "norepo";
}

export function createRepoBrainScope(
  input: RepoBrainScopeInput,
): RepoBrainScope {
  const owner = clean(input.owner);
  const repo = clean(input.repo);
  if (!owner || !repo) {
    throw new Error("Repo Brain scope requires owner and repo");
  }

  const scope: RepoBrainScope = {
    type: "repo",
    owner,
    repo,
    repoSlug: `${owner}/${repo}`,
    key: repoBrainScopeKey({ owner, repo }),
  };

  const storeRepoUrl = clean(input.storeRepoUrl);
  const storeRef = clean(input.storeRef);
  if (storeRepoUrl) scope.storeRepoUrl = storeRepoUrl;
  if (storeRef) scope.storeRef = storeRef;

  return scope;
}

export function repoBrainConversationKey(
  scopeKey: string | null | undefined,
  target: RepoBrainConversationTarget,
): string {
  const scope = clean(scopeKey).toLowerCase() || "norepo";
  switch (target.type) {
    case "task":
      return `${scope}::task-${target.id}`;
    case "capability":
      return `${scope}::capability-${target.slug}`;
    case "global":
      return `${scope}::global-${target.sessionId}`;
  }
}
