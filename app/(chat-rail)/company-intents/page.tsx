/**
 * @fileType page
 * @domain kody
 * @pattern companyIntents
 * @ai-summary Company intents page for CTO company-manager guidance.
 */
import { CompanyIntentsView } from "@dashboard/lib/components/CompanyIntentsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Intents - Kody Operations Dashboard",
  description: "CTO company-manager guidance for goals, loops, and capabilities.",
  path: "/company-intents",
});

export default function CompanyIntentsPage() {
  return <CompanyIntentsView />;
}
