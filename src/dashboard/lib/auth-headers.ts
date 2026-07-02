/**
 * @fileType utility
 * @domain kody
 * @pattern auth-headers
 * @ai-summary Shared browser-to-API auth headers, including Store identity.
 */

export const DEFAULT_KODY_STORE_REPO_URL =
  "https://github.com/aharonyaircohen/kody-company-store";
export const DEFAULT_KODY_STORE_REF = "main";

export const KODY_AUTH_HEADERS = {
  token: "x-kody-token",
  owner: "x-kody-owner",
  repo: "x-kody-repo",
  userLogin: "x-kody-user-login",
  storeRepoUrl: "x-kody-store-repo-url",
  storeRef: "x-kody-store-ref",
} as const;

export interface KodyAuthHeaderContext {
  token: string;
  owner: string;
  repo: string;
  userLogin?: string;
  user?: { login?: string };
  storeRepoUrl?: string | null;
  storeRef?: string | null;
}

export function buildKodyAuthHeaders(
  auth: KodyAuthHeaderContext | null | undefined,
): Record<string, string> {
  if (!auth) return {};
  const userLogin = auth.userLogin ?? auth.user?.login;
  return {
    [KODY_AUTH_HEADERS.token]: auth.token,
    [KODY_AUTH_HEADERS.owner]: auth.owner,
    [KODY_AUTH_HEADERS.repo]: auth.repo,
    ...(userLogin ? { [KODY_AUTH_HEADERS.userLogin]: userLogin } : {}),
    [KODY_AUTH_HEADERS.storeRepoUrl]:
      auth.storeRepoUrl?.trim() || DEFAULT_KODY_STORE_REPO_URL,
    [KODY_AUTH_HEADERS.storeRef]:
      auth.storeRef?.trim() || DEFAULT_KODY_STORE_REF,
  };
}
