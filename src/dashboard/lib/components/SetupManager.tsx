/**
 * @fileType component
 * @domain wizards
 * @pattern setup-index
 * @ai-summary Setup home rendered in the standard PageShell (consistent
 *   with Commands/Brands/Todos pages): lists registered wizards as rows;
 *   each opens its own /setup/<slug> run page.
 */
"use client";

import { ChevronRight, Wand2 } from "lucide-react";
import Link from "next/link";

import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";
import { WIZARD_REGISTRY } from "../wizards/registry";
import { PageShell } from "./PageShell";

export function SetupManager() {
  return (
    <AuthGuard>
      <SetupManagerInner />
    </AuthGuard>
  );
}

function SetupManagerInner() {
  const { auth } = useAuth();
  return (
    <PageShell
      title="Setup"
      icon={Wand2}
      iconClassName="text-teal-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
    >
      <p className="text-sm text-muted-foreground">
        Guided wizards for configuring dashboard features.
      </p>
      <ul className="mt-4 space-y-2">
        {WIZARD_REGISTRY.map((wizard) => (
          <li key={wizard.slug}>
            <Link
              href={`/setup/${wizard.slug}`}
              className="group flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-teal-500/40"
            >
              <span>
                <span className="block text-sm font-medium">
                  {wizard.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {wizard.description}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
