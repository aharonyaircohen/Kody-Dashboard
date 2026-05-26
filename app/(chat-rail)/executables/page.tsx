/**
 * @fileType page
 * @domain executables
 * @pattern executables-page
 * @ai-summary Executables CRUD entry point. Manages custom `@kody <slug>`
 *   actions stored at `.kody/executables/<slug>/` in the connected repo —
 *   the engine resolves them before its own built-ins.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ExecutablesManager } from "@dashboard/lib/components/ExecutablesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Executables — Kody Operations Dashboard",
  description: "Manage custom @kody executables stored in the repo.",
  path: "/executables",
});

export default function ExecutablesPage() {
  return (
    <AuthGuard>
      <ExecutablesManager />
    </AuthGuard>
  );
}
