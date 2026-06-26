/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Selected capability route backed by state-repo capabilities storage.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesManager } from "@dashboard/lib/components/CapabilitiesManager";
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
      <CapabilitiesManager selectedSlug={slug} basePath="/capabilities" />
    </AuthGuard>
  );
}
