/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with bug report dialog pre-opened via URL /bug.
 *   Force static for OG tags - social media crawlers need metadata without auth.
 */
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildKodyMetadata } from "../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Report Bug — Kody Operations Dashboard",
  description: "Report a bug for the Kody AI build agent",
  path: "/bug",
});

export default async function KodyBugReportPage() {
  return <KodyDashboard initialModal="bug" />;
}
