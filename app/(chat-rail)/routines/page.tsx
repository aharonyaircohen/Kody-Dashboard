/**
 * @fileType page
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Routine page for ongoing schedule/health managed goals.
 */

import { ManagedGoalsView } from "@dashboard/lib/components/ManagedGoalsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Routines - Kody Operations Dashboard",
  description: "Ongoing Kody routines driven by schedule and health state.",
  path: "/routines",
});

export default function RoutinesPage() {
  return <ManagedGoalsView model="routine" />;
}
