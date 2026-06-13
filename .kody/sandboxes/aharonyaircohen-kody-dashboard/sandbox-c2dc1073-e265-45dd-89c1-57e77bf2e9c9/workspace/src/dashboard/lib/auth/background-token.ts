/**
 * @fileType utility
 * @domain auth
 * @pattern background-token-policy
 * @ai-summary The single token resolver for unattended background work
 *   (webhook fan-out, ownerless server flows). Policy, not mechanism: prefer
 *   the GitHub App installation token (its own per-install rate-limit bucket,
 *   can't flag a human account), and fall back to the repo's vault
 *   `GITHUB_TOKEN` only when the App isn't installed/configured.
 *
 *   Every webhook dispatcher resolves its token here so the App-vs-vault
 *   decision lives in one place. Returns null when neither source yields a
 *   token (caller logs + no-ops). Never throws.
 */
import "server-only";
import { getInstallationToken } from "./app-token";
import { resolveVaultGithubToken } from "../vault/bootstrap";

export interface BackgroundToken {
  token: string;
  /** Which source supplied it — for logging / attribution clarity. */
  source: "app" | "vault";
}

/**
 * Resolve a token for background work on `owner/repo`. App installation token
 * first; vault `GITHUB_TOKEN` fallback. Null when neither is available.
 */
export async function resolveBackgroundToken(
  owner: string,
  repo: string,
): Promise<BackgroundToken | null> {
  const appToken = await getInstallationToken(owner, repo);
  if (appToken) return { token: appToken, source: "app" };

  const vaultToken = await resolveVaultGithubToken(owner, repo);
  if (vaultToken) return { token: vaultToken, source: "vault" };

  return null;
}
