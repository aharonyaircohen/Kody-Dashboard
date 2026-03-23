/**
 * @fileType page
 * @domain kody
 * @pattern scenario-wizard-page
 * @ai-summary Scenario creation wizard page - 4-step flow to create scenarios
 */
import { ScenarioWizard } from "./components/ScenarioWizard";

export const metadata = {
  title: "Create Scenario",
  description: "Create a new scenario using the step-by-step wizard",
  path: "/scenario",
};

export default async function ScenarioPage() {
  return <ScenarioWizard />;
}
