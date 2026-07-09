/**
 * @fileType utility
 * @domain client-auth
 * @pattern provider-credentials
 * @ai-summary Resolve Google OAuth client credentials for the client-surface
 *   sign-in. The client ID is public config and lives in /variables
 *   (GOOGLE_CLIENT_ID); the secret lives in the /secrets vault
 *   (GOOGLE_CLIENT_SECRET). Both fall through to process.env — the same
 *   vault→env fallthrough contract as `getSecret`.
 */
import {
  resolvePublicStateVariable,
  resolveVaultGithubToken,
} from "../vault/bootstrap";
import {
  type ClientBrandRepoContext,
} from "../client-brand-repo-cookie";

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

async function resolveOne(
  name: string,
  context: ClientBrandRepoContext | null,
  read: (owner: string, repo: string, name: string) => Promise<string | null>,
): Promise<string | null> {
  if (context) {
    const fromState = await read(context.owner, context.repo, name);
    if (fromState) return fromState;
  }
  return process.env[name] ?? null;
}

export async function resolveGoogleCredentials(
  context: ClientBrandRepoContext | null,
): Promise<GoogleClientCredentials | null> {
  const [clientId, clientSecret] = await Promise.all([
    resolveOne("GOOGLE_CLIENT_ID", context, resolvePublicStateVariable),
    resolveOne("GOOGLE_CLIENT_SECRET", context, (owner, repo, name) =>
      resolveVaultGithubToken(owner, repo, name),
    ),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
