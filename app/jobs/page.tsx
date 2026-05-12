/**
 * @fileType page
 * @domain kody
 * @pattern jobs-page
 * @ai-summary Jobs entry point. Renders a tabbed shell hosting Job Control
 *   and Reports under a single route. Tab persisted via `?tab=` query string.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { JobsPageTabs } from "@dashboard/lib/components/JobsPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Jobs — Kody Operations Dashboard",
  description: "Manage Kody jobs and review their reports.",
  path: "/jobs",
});

export default function JobsPage() {
  return (
    <AuthGuard>
      <JobsPageTabs />
    </AuthGuard>
  );
}
