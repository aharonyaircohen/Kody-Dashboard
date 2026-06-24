/**
 * @fileType page
 * @domain agentActions
 * @pattern agentActions-page
 * @ai-summary AgentActions list (`.kody/agent-actions/<slug>/`) with create /
 *   edit / delete. AgentResponsibilities own public actions and execution assignment.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentActionsManager } from "@dashboard/lib/components/AgentActionsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Actions — Kody Operations Dashboard",
  description: "Manage custom agentAction implementations.",
  path: "/agent-actions",
});

export default function AgentActionsPage() {
  return (
    <AuthGuard>
      <AgentActionsManager />
    </AuthGuard>
  );
}
