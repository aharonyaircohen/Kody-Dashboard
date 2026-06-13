/**
 * @fileType component
 * @domain kody
 *
 * AuthGuard — historically redirected to `/login` when no PAT was saved.
 * With the login route removed, gating now lives inside `KodyDashboard`
 * itself: it preserves the chrome (header + chat rail) and renders the
 * `<RepoManager />` empty-state in the task pane when no credentials
 * exist. This component is kept as a passthrough so its call sites stay
 * stable, and so the loading flash during auth hydration is centralised.
 */
"use client";

import { useAuth } from "@dashboard/lib/auth-context";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <>{children}</>;
}
