/**
 * @fileType page
 * @domain kody
 * @pattern agent-page
 * @ai-summary Agent entry point. Renders a tabbed shell hosting Agent
 *   Control under a single route. Mirrors the Duties page; starts empty
 *   (no duties are copied — `.kody/agents/` is its own directory).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentsPageTabs } from "@dashboard/lib/components/AgentsPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Agent — Kody Operations Dashboard",
  description: "Manage Kody agent.",
  path: "/agents",
});

export default function AgentsPage() {
  return (
    <AuthGuard>
      <AgentsPageTabs />
    </AuthGuard>
  );
}
