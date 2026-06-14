/**
 * @fileType component
 * @domain kody
 * @pattern first-run-connect
 * @ai-summary First-run connect screen. Shown by KodyDashboard when no repo
 *   is stored yet (auth === null) — there's no header to click before the
 *   first repo exists, so the connect form lives on the page here. Once a repo
 *   is connected, switching/adding/removing repos all happen in the header
 *   RepoSwitcher dropdown; this screen is only the bootstrap entry point.
 *   The PAT stays in this browser only — nothing is sent to a Kody backend.
 */
"use client";

import { Github } from "lucide-react";
import { PageShell } from "./PageShell";
import { Card, CardContent } from "@dashboard/ui/card";
import { AddRepoForm } from "./AddRepoForm";
import { useAuth } from "../auth-context";

export function RepoManager() {
  const { auth } = useAuth();

  // Empty-state mode: when `auth` is null this is the very first repo the
  // user is adding. `addRepo` bootstraps the entire kody_auth object from the
  // server response and the form reloads to `/` on success.
  const isBootstrap = !auth;

  return (
    <PageShell
      title="Connect a repository"
      icon={Github}
      iconClassName="text-white/80"
      width="wide"
    >
      <div className="space-y-6">
        <p className="text-sm text-white/60">
          Welcome. Connect a GitHub repository with a personal access token to
          start using the dashboard. The token stays in this browser only —
          nothing is sent to a Kody backend. Once connected, switch or add more
          repositories from the repo menu in the header.
        </p>

        <Card>
          <CardContent className="p-4">
            <AddRepoForm isBootstrap={isBootstrap} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
