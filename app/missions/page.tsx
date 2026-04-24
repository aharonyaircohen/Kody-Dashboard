/**
 * @fileType page
 * @domain kody
 * @pattern mission-control-page
 * @ai-summary Mission Control entry point. Renders under AuthGuard like the main dashboard.
 */
import { MissionControl } from "@dashboard/lib/components/MissionControl";
import { ControlTabs } from "@dashboard/lib/components/ControlTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Mission Control — Kody Operations Dashboard",
  description: "Manage Kody missions: intent, system prompt, allowed commands, and restrictions.",
  path: "/missions",
});

export default function MissionsPage() {
  return <MissionControl titleSlot={<ControlTabs active="missions" />} />;
}
