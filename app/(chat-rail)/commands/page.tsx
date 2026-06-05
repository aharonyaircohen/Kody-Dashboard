/**
 * @fileType page
 * @domain commands
 * @pattern commands-page
 * @ai-summary Commands CRUD entry point. Manages slash-command commands
 *   stored at `.kody/commands/<slug>.md` and the dashboard built-ins
 *   that ship with the codebase. These appear as `/<slug>` in the
 *   chat composer.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CommandsManager } from "@dashboard/lib/components/CommandsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Commands",
  description: "Manage slash commands for the dashboard chat.",
  path: "/commands",
});

export default function CommandsPage() {
  return (
    <AuthGuard>
      <CommandsManager />
    </AuthGuard>
  );
}
