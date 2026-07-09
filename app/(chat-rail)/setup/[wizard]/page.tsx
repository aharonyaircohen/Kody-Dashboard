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
import { PageShell } from "@dashboard/lib/components/PageShell";
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
        <PageShell
          title="Client sign-in setup"
          subtitle="Pick the sign-in method to configure — run once per method."
          backHref="/setup"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {Object.keys(PROVIDER_CATALOG).map((id) => (
              <li key={id}>
                <Link
                  href={`/setup/${CLIENT_SIGNIN_WIZARD_SLUG}?provider=${id}`}
                  className="block rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-teal-500/40"
                >
                  {providerLabel(id)}
                </Link>
              </li>
            ))}
          </ul>
        </PageShell>
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
