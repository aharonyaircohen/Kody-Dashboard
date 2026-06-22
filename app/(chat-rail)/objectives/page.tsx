/**
 * @fileType page
 * @domain kody
 * @pattern objectives
 * @ai-summary Objective page for finite, evidence-driven operating models.
 */

import { ManagedModelsView } from "@dashboard/lib/components/ManagedModelsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Objectives - Kody Operations Dashboard",
  description: "Finite Kody objectives driven by missing evidence.",
  path: "/objectives",
});

export default function ObjectivesPage() {
  return <ManagedModelsView model="objective" />;
}
