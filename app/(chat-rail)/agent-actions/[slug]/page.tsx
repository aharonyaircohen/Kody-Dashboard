/**
 * @fileType page
 * @domain agentActions
 * @pattern agentActions-page
 * @ai-summary Edit one agentAction implementation at `/agent-actions/<slug>`. Its own
 *   route so the browser Back button returns to the agentActions list.
 *   Rendered dynamically — slugs are repo-defined, so they can't be
 *   pre-generated.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentActionEditorPage } from "@dashboard/lib/components/AgentActionsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Edit agentAction — Kody Operations Dashboard",
  description: "Edit an agentAction implementation.",
  path: "/agent-actions",
});

export default async function EditAgentActionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <AgentActionEditorPage slug={slug} />
    </AuthGuard>
  );
}
