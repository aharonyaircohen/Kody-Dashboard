/**
 * @fileType page
 * @domain kody
 * @pattern reports-page
 * @ai-summary Reports entry point. Renders under AuthGuard like the
 *   main dashboard. Shows system reports under `.kody/reports/`.
 */
import { ReportsView } from "@dashboard/lib/components/ReportsView";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Reports — Kody Operations Dashboard",
  description:
    "System reports produced by Kody jobs (doc-drift, coverage-floor, etc.).",
  path: "/reports",
});

export default function ReportsPage() {
  return <ReportsView />;
}
