/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Root dashboard. `/` renders the operations overview
 *   (DashboardHome) — task counts, quick links, and recent activity. It used
 *   to redirect to /tasks; now it's a real landing, with Tasks/Vibe one click
 *   away in the rail's "Views" group. Force static for OG tags — social
 *   crawlers need metadata without auth; AuthGuard gates the live content.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DashboardHome } from "@dashboard/lib/components/DashboardHome";
import { buildKodyMetadata } from "./metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Happening now",
  description:
    "Monitor and manage AI coding agent tasks, pipelines, and deployments",
  path: "/",
});

export default function KodyPage() {
  return (
    <AuthGuard>
      <DashboardHome />
    </AuthGuard>
  );
}
