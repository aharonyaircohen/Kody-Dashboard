/**
 * @fileType page
 * @domain client-chat
 * @pattern client-chat-route
 * @ai-summary Brand-scoped client chat route. It renders a standalone shell
 *   around the real KodyChat and stays outside the dashboard chat rail.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { ClientChatSurface } from "@dashboard/lib/components/ClientChatSurface";
import {
  resolveClientBrand,
  type ClientBrandResolveContext,
} from "@dashboard/lib/client-brand";
import { getClientSurfaceCatalog } from "@dashboard/lib/client-chat-strings";
import {
  CLIENT_BRAND_REPO_COOKIE,
  parseClientBrandRepoCookie,
  type ClientBrandRepoContext,
} from "@dashboard/lib/client-brand-repo-cookie";
import { mintClientSurfaceTicket } from "@dashboard/lib/chat/platform/surface-scope";
import { resolveVaultGithubToken } from "@dashboard/lib/vault/bootstrap";
import { defaultClientBrandRepoContext } from "@dashboard/lib/client-brand-default-repo";
import { auth, signOut } from "@dashboard/lib/client-auth/auth";
import {
  brandAuthProviders,
  isEmailAllowed,
} from "@dashboard/lib/client-auth/allowlist";
import { resolveConfiguredProviders } from "@dashboard/lib/client-auth/credentials";
import { ClientAuthGate } from "@dashboard/lib/client-auth/ClientAuthGate";

interface ClientChatPageProps {
  params: Promise<{ brandSlug: string }>;
}

async function withVaultToken(
  context: ClientBrandRepoContext,
): Promise<ClientBrandResolveContext> {
  const token = await resolveVaultGithubToken(context.owner, context.repo);
  return {
    ...context,
    ...(token ? { token } : {}),
  };
}

/**
 * Resolve the brand plus the repo context it was found under. Client
 * visitors don't carry the dashboard's brand-repo cookie (and since the
 * cookie started tracking the last-visited repo it may point at a repo
 * with no brands at all), so fall back to the configured default repo
 * whenever the cookie context is absent or doesn't know the brand.
 */
async function resolveBrandAndContext(brandSlug: string): Promise<{
  brand: Awaited<ReturnType<typeof resolveClientBrand>>;
  context: ClientBrandResolveContext | null;
}> {
  const cookieStore = await cookies();
  const cookieContext = parseClientBrandRepoCookie(
    cookieStore.get(CLIENT_BRAND_REPO_COOKIE)?.value,
  );

  if (cookieContext) {
    const context = await withVaultToken(cookieContext);
    const brand = await resolveClientBrand(brandSlug, context);
    // Repo brands carry their auth block; a builtin/default fallback does
    // not, so a brand without one may live in the default repo instead.
    if (brand?.auth) return { brand, context };
  }

  const defaultContext = defaultClientBrandRepoContext();
  if (
    defaultContext &&
    (defaultContext.owner !== cookieContext?.owner ||
      defaultContext.repo !== cookieContext?.repo)
  ) {
    const context = await withVaultToken(defaultContext);
    const brand = await resolveClientBrand(brandSlug, context);
    if (brand) return { brand, context };
  }

  if (cookieContext) {
    const context = await withVaultToken(cookieContext);
    return { brand: await resolveClientBrand(brandSlug, context), context };
  }
  return { brand: await resolveClientBrand(brandSlug, null), context: null };
}

export async function generateMetadata({
  params,
}: ClientChatPageProps): Promise<Metadata> {
  const { brandSlug } = await params;
  const { brand } = await resolveBrandAndContext(brandSlug);
  if (!brand) notFound();

  const catalog = getClientSurfaceCatalog(brand.locale ?? "en");

  return {
    title: catalog.t("chat.client.metaTitle", { brand: brand.name }),
    description: catalog.t("chat.client.metaDescription", {
      brand: brand.name,
    }),
  };
}

export default async function ClientChatPage({ params }: ClientChatPageProps) {
  const { brandSlug } = await params;
  const { brand, context } = await resolveBrandAndContext(brandSlug);
  if (!brand) notFound();

  let surfaceUser:
    | { name?: string | null; email?: string | null; image?: string | null }
    | undefined;

  if (brand.auth?.required) {
    const callbackUrl = `/client/${brand.slug}`;
    const providers = await resolveConfiguredProviders(
      brandAuthProviders(brand.auth),
      context,
    );
    if (!providers.length) {
      return <ClientAuthGate brand={brand} callbackUrl={callbackUrl} misconfigured />;
    }
    const session = await auth();
    const email = session?.user?.email;
    if (!email) {
      // No auto-signIn here: OAuth signIn needs to set CSRF/PKCE cookies,
      // which a Server Component render can't do — it silently produced a
      // blank page. The gate's button submits a server action instead.
      return (
        <ClientAuthGate
          brand={brand}
          callbackUrl={callbackUrl}
          providers={providers}
        />
      );
    }
    if (!isEmailAllowed(brand.auth, email)) {
      return (
        <ClientAuthGate
          brand={brand}
          callbackUrl={callbackUrl}
          deniedEmail={email}
        />
      );
    }
    surfaceUser = {
      name: session?.user?.name,
      email,
      image: session?.user?.image,
    };
  }

  let ticket: string | undefined;
  if (context?.token) {
    try {
      ticket = mintClientSurfaceTicket({
        brandSlug: brand.slug,
        owner: context.owner,
        repo: context.repo,
      }).ticket;
    } catch {
      ticket = undefined;
    }
  }

  const callbackUrl = `/client/${brand.slug}`;
  return (
    <ClientChatSurface
      brand={brand}
      surfaceTicket={ticket}
      user={surfaceUser}
      signOutAction={
        surfaceUser
          ? async () => {
              "use server";
              await signOut({ redirectTo: callbackUrl });
            }
          : undefined
      }
    />
  );
}
