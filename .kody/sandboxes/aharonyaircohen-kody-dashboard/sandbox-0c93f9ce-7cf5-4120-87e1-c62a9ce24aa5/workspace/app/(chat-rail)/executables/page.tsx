/**
 * @fileType page
 * @domain executables
 * @pattern executables-page
 * @ai-summary Executables list (`.kody/executables/<slug>/`) with create /
 *   edit / delete. Duties own public actions and execution assignment.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ExecutablesManager } from "@dashboard/lib/components/ExecutablesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Executables — Kody Operations Dashboard",
  description: "Manage custom executable implementations.",
  path: "/executables",
});

export default function ExecutablesPage() {
  return (
    <AuthGuard>
      <ExecutablesManager />
    </AuthGuard>
  );
}
