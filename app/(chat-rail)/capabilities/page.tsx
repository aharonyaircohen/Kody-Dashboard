/**
 * @fileType page
 * @domain capabilities
 * @pattern capabilities-page
 * @ai-summary Capability list backed by state-repo capabilities storage.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CapabilitiesManager } from "@dashboard/lib/components/CapabilitiesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Capabilities — Kody Operations Dashboard",
  description: "Manage reusable Kody capabilities.",
  path: "/capabilities",
});

export default function CapabilitiesPage() {
  return (
    <AuthGuard>
      <CapabilitiesManager basePath="/capabilities" />
    </AuthGuard>
  );
}
