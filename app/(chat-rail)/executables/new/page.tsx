/**
 * @fileType page
 * @domain executables
 * @pattern executables-page
 * @ai-summary Create a new executable. Its own route so the browser
 *   Back button returns to the executables list.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ExecutableEditorPage } from "@dashboard/lib/components/ExecutablesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "New executable — Kody Operations Dashboard",
  description: "Create a custom @kody executable.",
  path: "/executables/new",
});

export default function NewExecutablePage() {
  return (
    <AuthGuard>
      <ExecutableEditorPage slug={null} />
    </AuthGuard>
  );
}
