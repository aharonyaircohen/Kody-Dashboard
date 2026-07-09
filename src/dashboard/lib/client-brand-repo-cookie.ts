/**
 * @fileType utility
 * @domain client-chat
 * @pattern public-brand-repo-cookie
 * @ai-summary Tiny non-secret cookie that tells server-rendered `/client/*`
 *   pages which connected repo's brand registry to read. It stores repo
 *   identity only, never a GitHub token.
 */

export const CLIENT_BRAND_REPO_COOKIE = "kody_client_brand_repo";

export interface ClientBrandRepoContext {
  owner: string;
  repo: string;
  storeRepoUrl?: string;
  storeRef?: string;
}

function clean(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseClientBrandRepoCookie(
  raw: string | undefined,
): ClientBrandRepoContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Record<
      string,
      unknown
    >;
    const owner = clean(parsed.owner);
    const repo = clean(parsed.repo);
    if (!owner || !repo) return null;
    const storeRepoUrl = clean(parsed.storeRepoUrl);
    const storeRef = clean(parsed.storeRef);
    return {
      owner,
      repo,
      ...(storeRepoUrl ? { storeRepoUrl } : {}),
      ...(storeRef ? { storeRef } : {}),
    };
  } catch {
    return null;
  }
}

export function serializeClientBrandRepoCookie(
  input: ClientBrandRepoContext,
): string {
  return encodeURIComponent(
    JSON.stringify({
      owner: input.owner,
      repo: input.repo,
      ...(input.storeRepoUrl ? { storeRepoUrl: input.storeRepoUrl } : {}),
      ...(input.storeRef ? { storeRef: input.storeRef } : {}),
    }),
  );
}
