/**
 * @fileType page
 * @domain agentActions
 * @pattern agentActions-page
 * @ai-summary Create a new agentAction. Its own route so the browser
 *   Back button returns to the agentActions list.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentActionEditorPage } from "@dashboard/lib/components/AgentActionsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "New action — Kody Operations Dashboard",
  description: "Create a custom action implementation.",
  path: "/agent-actions/new",
});

export default function NewAgentActionPage() {
  return (
    <AuthGuard>
      <AgentActionEditorPage slug={null} />
    </AuthGuard>
  );
}
