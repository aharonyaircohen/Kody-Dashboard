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
} from "@dashboard/lib/client-brand-repo-cookie";
import { mintClientSurfaceTicket } from "@dashboard/lib/chat/platform/surface-scope";
import { resolveVaultGithubToken } from "@dashboard/lib/vault/bootstrap";
import { auth, signIn } from "@dashboard/lib/client-auth/auth";
import {
  brandAuthProviders,
  isEmailAllowed,
} from "@dashboard/lib/client-auth/allowlist";
import { resolveConfiguredProviders } from "@dashboard/lib/client-auth/credentials";
import { ClientAuthGate } from "@dashboard/lib/client-auth/ClientAuthGate";

interface ClientChatPageProps {
  params: Promise<{ brandSlug: string }>;
}

async function clientBrandRepoContext(): Promise<ClientBrandResolveContext | null> {
  const cookieStore = await cookies();
  const context = parseClientBrandRepoCookie(
    cookieStore.get(CLIENT_BRAND_REPO_COOKIE)?.value,
  );
  if (!context) return null;
  const token = await resolveVaultGithubToken(context.owner, context.repo);
  return {
    ...context,
    ...(token ? { token } : {}),
  };
}

export async function generateMetadata({
  params,
}: ClientChatPageProps): Promise<Metadata> {
  const { brandSlug } = await params;
  const brand = await resolveClientBrand(
    brandSlug,
    await clientBrandRepoContext(),
  );
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
  const context = await clientBrandRepoContext();
  const brand = await resolveClientBrand(brandSlug, context);
  if (!brand) notFound();

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
      if (providers.length === 1) {
        // Single method → straight to the provider, no interstitial click.
        await signIn(providers[0], { redirectTo: callbackUrl });
        return null;
      }
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

  return <ClientChatSurface brand={brand} surfaceTicket={ticket} />;
}
