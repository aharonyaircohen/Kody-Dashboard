/**
 * @fileType page
 * @domain kody
 * @pattern agency-runs-page
 * @ai-summary Agency Runs page for Kody-native goal, loop, and workflow runs.
 */

import { AgencyRunsPage } from "@dashboard/lib/components/AgencyRunsPage";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Agency Runs - Kody Operations Dashboard",
  description: "Kody-native runs for AI Agency goals, loops, and workflows.",
  path: "/agency-runs",
});

export default function AgencyRunsRoute() {
  return <AgencyRunsPage />;
}
