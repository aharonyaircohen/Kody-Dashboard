/**
 * @fileType page
 * @domain prompts
 * @pattern prompts-page
 * @ai-summary Prompts CRUD entry point. Manages slash-command prompts
 *   stored at `.kody/prompts/<slug>.md` and the dashboard built-ins
 *   that ship with the codebase. These appear as `/<slug>` in the
 *   chat composer.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { PromptsManager } from "@dashboard/lib/components/PromptsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Prompts — Kody Operations Dashboard",
  description: "Manage slash-command prompts for the dashboard chat.",
  path: "/prompts",
});

export default function PromptsPage() {
  return (
    <AuthGuard>
      <PromptsManager />
    </AuthGuard>
  );
}
