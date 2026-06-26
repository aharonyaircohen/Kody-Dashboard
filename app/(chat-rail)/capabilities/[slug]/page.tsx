/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Selected capability route backed by state-repo capabilities storage.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgentActionsManager } from "@dashboard/lib/components/AgentActionsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Capability — Kody Operations Dashboard",
  description: "View a selected Kody capability.",
  path: "/capabilities",
});

export default async function CapabilityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <AgentActionsManager selectedSlug={slug} basePath="/capabilities" />
    </AuthGuard>
  );
}
