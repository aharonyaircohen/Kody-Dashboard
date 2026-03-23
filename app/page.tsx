/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Main Kody dashboard page. Auth handled client-side via SessionExpiredError.
 *   Force static for OG tags - social media crawlers need metadata without auth.
 */
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildKodyMetadata } from "./metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Kody Operations Dashboard",
  description:
    "Monitor and manage AI coding agent tasks, pipelines, and deployments",
  path: "/",
});

export default async function KodyPage() {
  return <KodyDashboard />;
}
