/**
 * @fileType page
 * @domain kody
 * @pattern goal-control-page
 * @ai-summary Goals entry point. Renders the GoalControl panel with shared
 *   Missions/Goals tabs. Sibling of /missions.
 */
import { GoalControl } from "@dashboard/lib/components/GoalControl";
import { ControlTabs } from "@dashboard/lib/components/ControlTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Goals — Kody Operations Dashboard",
  description: "Group tasks into goals and track progress toward outcomes.",
  path: "/goals",
});

export default function GoalsPage() {
  return <GoalControl titleSlot={<ControlTabs active="goals" />} />;
}
