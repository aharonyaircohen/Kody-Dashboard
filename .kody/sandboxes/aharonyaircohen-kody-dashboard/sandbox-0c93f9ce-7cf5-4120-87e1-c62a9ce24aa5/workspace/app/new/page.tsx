/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with create task dialog pre-opened via URL /new.
 *   Force static for OG tags - social media crawlers need metadata without auth.
 */
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildKodyMetadata } from "../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Create Task — Kody Operations Dashboard",
  description: "Create a new task for the Kody AI build agent",
  path: "/new",
});

export default async function KodyNewTaskPage() {
  return <KodyDashboard initialModal="new" />;
}
