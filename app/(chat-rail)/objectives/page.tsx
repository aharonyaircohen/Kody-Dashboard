/**
 * @fileType page
 * @domain kody
 * @pattern managed-goals
 * @ai-summary Objective page for finite, evidence-driven managed goals.
 */

import { ManagedGoalsView } from "@dashboard/lib/components/ManagedGoalsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Objectives - Kody Operations Dashboard",
  description: "Finite Kody objectives driven by missing evidence.",
  path: "/objectives",
});

export default function ObjectivesPage() {
  return <ManagedGoalsView model="objective" />;
}
