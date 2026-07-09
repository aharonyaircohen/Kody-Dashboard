/**
 * @fileType page
 * @domain wizards
 * @pattern wizard-page
 * @ai-summary Runs a named setup wizard. `client-signin` builds per-provider
 *   from the client-auth catalog: no `?provider=` shows a provider picker;
 *   with one, the generic WizardRunner walks the declarative steps.
 */
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { WizardRunner } from "@dashboard/lib/components/WizardRunner";
import {
  PROVIDER_CATALOG,
  providerLabel,
} from "@dashboard/lib/client-auth/catalog";
import {
  CLIENT_SIGNIN_WIZARD_SLUG,
  clientSigninWizard,
} from "@dashboard/lib/wizards/client-signin";
import { getWizardEntry } from "@dashboard/lib/wizards/registry";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Setup — Kody Operations Dashboard",
  description: "Guided setup wizards.",
  path: "/setup",
});

interface WizardPageProps {
  params: Promise<{ wizard: string }>;
  searchParams: Promise<{ provider?: string }>;
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://your-dashboard";
}

export default async function WizardPage({
  params,
  searchParams,
}: WizardPageProps) {
  const { wizard } = await params;
  if (!getWizardEntry(wizard) || wizard !== CLIENT_SIGNIN_WIZARD_SLUG) {
    notFound();
  }

  const { provider } = await searchParams;
  if (!provider) {
    return (
      <AuthGuard>
        <div className="mx-auto w-full max-w-2xl p-4">
          <h1 className="text-lg font-semibold">Client sign-in setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick the sign-in method to configure. You can run this wizard once
            per method.
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {Object.keys(PROVIDER_CATALOG).map((id) => (
              <li key={id}>
                <Link
                  href={`/setup/${CLIENT_SIGNIN_WIZARD_SLUG}?provider=${id}`}
                  className="block rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium hover:border-primary"
                >
                  {providerLabel(id)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </AuthGuard>
    );
  }

  const definition = clientSigninWizard(provider, await requestOrigin());
  if (!definition) notFound();

  return (
    <AuthGuard>
      <WizardRunner
        definition={definition}
        instanceKey={provider}
        doneHref="/brands"
      />
    </AuthGuard>
  );
}
