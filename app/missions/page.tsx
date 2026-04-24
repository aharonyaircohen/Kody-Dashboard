/**
 * @fileType page
 * @domain kody
 * @pattern mission-control-page
 * @ai-summary Mission Control entry point. Renders under AuthGuard like the main dashboard.
 */
import { ControlCenter } from "@dashboard/lib/components/ControlCenter";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Mission Control — Kody Operations Dashboard",
  description: "Manage Kody missions and goals from a single control center.",
  path: "/missions",
});

export default function MissionsPage() {
  return <ControlCenter />;
}
