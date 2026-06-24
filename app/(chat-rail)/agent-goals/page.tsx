/**
 * @fileType page
 * @domain kody
 * @pattern agentGoals
 * @ai-summary AgentGoal page for finite, evidence-driven operating models.
 */

import { ManagedModelsView } from "@dashboard/lib/components/ManagedModelsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Goals - Kody Operations Dashboard",
  description: "Finite Kody goals driven by missing evidence.",
  path: "/agent-goals",
});

export default function AgentGoalsPage() {
  return <ManagedModelsView model="agentGoal" />;
}
