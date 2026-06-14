/**
 * @fileType component
 * @domain kody
 * @pattern repo-config-manager
 * @ai-summary The repo-scoped engine config page (/config). Edits the
 *   kody.config.json fields that affect the whole repo: the operator list,
 *   quality verification commands, the `@kody` access gate, default branch,
 *   and comment aliases. Distinct from the Company page, which is only
 *   import/export of the portable bundle. Per-executable model routing lives
 *   on /models (it's a model concern).
 */
"use client";

import { SlidersHorizontal } from "lucide-react";
import { PageShell } from "./PageShell";
import { OperatorsCard } from "./OperatorsCard";
import { EngineConfigCards } from "./EngineConfigCards";
import { AuthGuard } from "../auth-guard";
import { useAuth } from "../auth-context";

export function RepoConfigManager() {
  return (
    <AuthGuard>
      <RepoConfigManagerInner />
    </AuthGuard>
  );
}

function RepoConfigManagerInner() {
  const { auth } = useAuth();
  return (
    <PageShell
      title="Config"
      icon={SlidersHorizontal}
      iconClassName="text-emerald-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60 max-w-2xl">
          Repo-wide engine settings stored in{" "}
          <code className="text-white/80">kody.config.json</code>. These apply
          to everyone working in this repo. Per-repo secrets live under{" "}
          <span className="text-white/80">Secrets</span>; model selection under{" "}
          <span className="text-white/80">Chat Models</span>.
        </p>

        <OperatorsCard />
        <EngineConfigCards />
      </div>
    </PageShell>
  );
}
