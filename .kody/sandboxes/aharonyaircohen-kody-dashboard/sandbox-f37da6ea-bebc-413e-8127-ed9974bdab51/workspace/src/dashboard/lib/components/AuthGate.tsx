/**
 * @fileType component
 * @domain kody
 *
 * Server component wrapper — adds AuthGuard around KodyDashboard.
 * Keep KodyPage as a server component for OG metadata.
 */
"use client";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";

export function AuthGate() {
  return (
    <AuthGuard>
      <KodyDashboard />
    </AuthGuard>
  );
}
