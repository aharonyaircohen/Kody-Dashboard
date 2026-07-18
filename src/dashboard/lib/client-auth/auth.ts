/**
 * @fileType utility
 * @domain client-auth
 * @pattern nextauth-instance
 * @ai-summary Auth.js (NextAuth v5) instance for brand-scoped client users.
 *   Fully stateless: JWT session cookie signed with a KODY_MASTER_KEY-derived
 *   secret, Google as the only provider, no database. Lazy config so Google
 *   credentials can come from the connected repo's vault per request.
 *   Separate from dashboard operator auth (header-based PAT) by design.
 */
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";

import { parseClientBrandRepoCookie, CLIENT_BRAND_REPO_COOKIE } from "../client-brand-repo-cookie";
import type { ClientBrandRepoContext } from "../client-brand-repo-cookie";
import { defaultClientBrandRepoContext } from "../client-brand-default-repo";
import { resolveBackgroundToken } from "../auth/background-token";
import { PROVIDER_CATALOG, isSupportedProviderId } from "./catalog";
import { resolveProviderCredentials } from "./credentials";
import { deriveClientAuthSecret } from "./secret";

export const CLIENT_AUTH_SESSION_COOKIE = "kody_client_session";

/** Pull owner/repo out of a repo-qualified client path
 *  (`/client/<owner>/<repo>/<brand>`), absolute or relative. */
function contextFromClientPath(
  value: string | null | undefined,
): ClientBrandRepoContext | null {
  if (!value) return null;
  const match = /\/client\/([^/?#]+)\/([^/?#]+)\/[^/?#]+/.exec(value);
  if (!match) return null;
  return {
    owner: decodeURIComponent(match[1]),
    repo: decodeURIComponent(match[2]),
  };
}

/** Derive the brand's repo from the auth request itself: the callback /
 *  redirect target or the referring page — all carry the repo-qualified
 *  client path. Fresh visitors have no dashboard cookie, so the URL is the
 *  only reliable source. */
async function requestClientContext(
  req: Request | undefined,
): Promise<ClientBrandRepoContext | null> {
  if (!req) {
    // `signIn()`/`auth()` outside the /api/auth handlers get no request —
    // fall back to the ambient request headers (works in any request scope).
    try {
      const { headers } = await import("next/headers");
      const ambient = await headers();
      return (
        contextFromClientPath(ambient.get("x-client-auth-redirect")) ??
        contextFromClientPath(ambient.get("referer"))
      );
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(req.url);
    return (
      contextFromClientPath(url.searchParams.get("callbackUrl")) ??
      contextFromClientPath(url.searchParams.get("redirectTo")) ??
      contextFromClientPath(url.pathname) ??
      contextFromClientPath(req.headers.get("referer"))
    );
  } catch {
    return null;
  }
}

type ProviderModule = {
  default: (options: Record<string, unknown>) => Provider;
};

// Explicit lazy imports (Turbopack can't bundle a fully dynamic
// `next-auth/providers/${id}` without dragging in nodemailer/webauthn).
// Adding a provider = one line here + one catalog entry.
const PROVIDER_IMPORTS: Record<string, () => Promise<ProviderModule>> = {
  google: () => import("next-auth/providers/google"),
  github: () => import("next-auth/providers/github"),
  "microsoft-entra-id": () => import("next-auth/providers/microsoft-entra-id"),
  apple: () => import("next-auth/providers/apple"),
  facebook: () => import("next-auth/providers/facebook"),
  slack: () => import("next-auth/providers/slack"),
  discord: () => import("next-auth/providers/discord"),
  linkedin: () => import("next-auth/providers/linkedin"),
  gitlab: () => import("next-auth/providers/gitlab"),
  auth0: () => import("next-auth/providers/auth0"),
  okta: () => import("next-auth/providers/okta"),
  keycloak: () => import("next-auth/providers/keycloak"),
};

/** Load an Auth.js provider module by its id (id = module filename). */
async function loadProvider(
  id: string,
  creds: { clientId: string; clientSecret: string; extra?: Record<string, string> },
): Promise<Provider | null> {
  const load = isSupportedProviderId(id) ? PROVIDER_IMPORTS[id] : undefined;
  if (!load) return null;
  try {
    const mod = await load();
    return mod.default({
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      ...(creds.extra ?? {}),
    });
  } catch {
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth(async (req) => {
  const cookieContext =
    (await requestClientContext(req)) ??
    parseClientBrandRepoCookie(
      req?.cookies.get(CLIENT_BRAND_REPO_COOKIE)?.value,
    ) ??
    defaultClientBrandRepoContext();
  // Authenticate credential reads with the repo's token (same as the page
  // does) — app installation token first, vault fallback. The state repo
  // may be private, so unauthenticated reads silently drop every provider.
  const repoContext = cookieContext
    ? {
        ...cookieContext,
        token:
          (
            await resolveBackgroundToken(
              cookieContext.owner,
              cookieContext.repo,
            )
          )?.token ?? undefined,
      }
    : null;
  // Register every catalog provider whose credentials are configured for
  // this repo; per-brand `providers` lists then choose what to offer.
  const loaded = await Promise.all(
    Object.keys(PROVIDER_CATALOG).map(async (id) => {
      const creds = await resolveProviderCredentials(id, repoContext);
      return creds ? loadProvider(id, creds) : null;
    }),
  );
  const providers = loaded.filter((p): p is Provider => p !== null);

  return {
    secret: deriveClientAuthSecret(),
    session: { strategy: "jwt" },
    trustHost: true,
    providers,
    events: {
      async signIn({ user, account }) {
        const { emitSystemEvent } = await import("@dashboard/lib/events");
        emitSystemEvent(
          "auth.signed_in",
          {
            kind: "client",
            ...(account?.provider ? { provider: account.provider } : {}),
          },
          {
            userId: user.email
              ? `client:${user.email.toLowerCase()}`
              : null,
            brand: cookieContext,
            source: "server",
          },
        );
      },
      async signOut() {
        const { emitSystemEvent } = await import("@dashboard/lib/events");
        emitSystemEvent(
          "auth.signed_out",
          { kind: "client" },
          { userId: null, brand: cookieContext, source: "server" },
        );
      },
    },
    cookies: {
      sessionToken: { name: CLIENT_AUTH_SESSION_COOKIE },
    },
    pages: {
      // Sign-in happens on the branded page itself; errors return there too.
      error: "/client",
    },
  };
});
