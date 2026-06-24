/**
 * @fileType page
 * @domain kody
 * @pattern agentResponsibilities-page
 * @ai-summary AgentResponsibilities entry point. Renders the agentResponsibility list (legacy functional AgentResponsibilityControl). No tabs; Reports
 *   have their own route (/reports).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentResponsibilitiesPageTabs } from "@dashboard/lib/components/AgentResponsibilitiesPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Responsibilities — Kody Operations Dashboard",
  description: "Manage Kody responsibilities and review their reports.",
  path: "/agent-responsibilities",
});

export default function AgentResponsibilitiesPage() {
  return (
    <AuthGuard>
      <AgentResponsibilitiesPageTabs />
    </AuthGuard>
  );
}
