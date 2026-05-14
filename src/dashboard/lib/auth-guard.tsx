/**
 * @fileType component
 * @domain kody
 *
 * AuthGuard — when no GitHub PAT is stored in localStorage, renders the
 * `<RepoManager />` empty-state instead of the requested page. Adding the
 * first repo bootstraps `kody_auth` and reloads, after which the gate
 * passes children through transparently.
 *
 * The dashboard no longer has a separate `/login` route — repo + PAT
 * entry happens inside the same dashboard shell as everything else.
 */
"use client";

import { useAuth } from "@dashboard/lib/auth-context";
import { RepoManager } from "@dashboard/lib/components/RepoManager";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { auth, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!auth) return <RepoManager />;

  return <>{children}</>;
}
