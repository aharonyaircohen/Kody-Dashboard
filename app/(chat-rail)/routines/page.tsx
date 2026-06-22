/**
 * @fileType page
 * @domain kody
 * @pattern routines
 * @ai-summary Routine page for ongoing schedule/health operating models.
 */

import { ManagedModelsView } from "@dashboard/lib/components/ManagedModelsView";
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Routines - Kody Operations Dashboard",
  description: "Ongoing Kody routines driven by schedule and health state.",
  path: "/routines",
});

export default function RoutinesPage() {
  return <ManagedModelsView model="routine" />;
}
