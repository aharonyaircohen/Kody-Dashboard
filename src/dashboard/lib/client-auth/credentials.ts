/**
 * @fileType utility
 * @domain client-auth
 * @pattern provider-credentials
 * @ai-summary Resolve OAuth client credentials per provider for the
 *   client-surface sign-in. Each provider's client ID is public config and
 *   lives in /variables; its secret lives in the /secrets vault. Both fall
 *   through to process.env — the same vault→env contract as `getSecret`.
 */
import type { ClientAuthProvider } from "./allowlist";
import {
  resolvePublicStateVariable,
  resolveVaultGithubToken,
} from "../vault/bootstrap";
import { type ClientBrandRepoContext } from "../client-brand-repo-cookie";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

const CREDENTIAL_NAMES: Record<
  ClientAuthProvider,
  { id: string; secret: string }
> = {
  google: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  github: { id: "GITHUB_OAUTH_CLIENT_ID", secret: "GITHUB_OAUTH_CLIENT_SECRET" },
};

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

export async function resolveProviderCredentials(
  provider: ClientAuthProvider,
  context: ClientBrandRepoContext | null,
): Promise<ProviderCredentials | null> {
  const names = CREDENTIAL_NAMES[provider];
  const [clientId, clientSecret] = await Promise.all([
    resolveOne(names.id, context, resolvePublicStateVariable),
    resolveOne(names.secret, context, (owner, repo, name) =>
      resolveVaultGithubToken(owner, repo, name),
    ),
  ]);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Providers from `wanted` that actually have credentials configured. */
export async function resolveConfiguredProviders(
  wanted: ClientAuthProvider[],
  context: ClientBrandRepoContext | null,
): Promise<ClientAuthProvider[]> {
  const checks = await Promise.all(
    wanted.map(async (provider) => ({
      provider,
      ok: (await resolveProviderCredentials(provider, context)) !== null,
    })),
  );
  return checks.filter((c) => c.ok).map((c) => c.provider);
}
