/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with the "Report a Kody bug" dialog pre-opened via
 *   URL /report-kody-bug. Files into the Kody repo, not the connected project.
 *   Force static for OG tags — social crawlers need metadata without auth.
 */
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildKodyMetadata } from "../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Report a Kody bug — Kody Operations Dashboard",
  description: "Report a bug in Kody itself (the dashboard or build agent)",
  path: "/report-kody-bug",
});

export default async function ReportKodyBugPage() {
  return <KodyDashboard initialModal="kody-bug" />;
}
