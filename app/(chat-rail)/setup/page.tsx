/**
 * @fileType page
 * @domain wizards
 * @pattern wizard-index
 * @ai-summary Setup home: lists every registered wizard; each opens on its
 *   own page at /setup/<slug>.
 */
import Link from "next/link";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { WIZARD_REGISTRY } from "@dashboard/lib/wizards/registry";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Setup — Kody Operations Dashboard",
  description: "Guided setup wizards.",
  path: "/setup",
});

export default function SetupIndexPage() {
  return (
    <AuthGuard>
      <div className="mx-auto w-full max-w-2xl p-4">
        <h1 className="text-lg font-semibold">Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Guided wizards for configuring dashboard features.
        </p>
        <ul className="mt-4 grid gap-2">
          {WIZARD_REGISTRY.map((wizard) => (
            <li key={wizard.slug}>
              <Link
                href={`/setup/${wizard.slug}`}
                className="block rounded-lg border border-border bg-card px-4 py-3 hover:border-primary"
              >
                <span className="text-sm font-medium">{wizard.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {wizard.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </AuthGuard>
  );
}
