/**
 * @fileType page
 * @domain kody
 * @pattern jobs-page
 * @ai-summary Jobs entry point. A job is the engine's unified execution unit —
 *   it assembles an executable (how) + duty (why) + staff (who) + schedule
 *   (when) into one run. Renders the JobComposer.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { JobsManager } from "@dashboard/lib/components/JobsManager";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Jobs — Kody Operations Dashboard",
  description:
    "Compose and run jobs — the engine's execution unit binding executable, duty, staff, and schedule.",
  path: "/jobs",
});

export default function JobsPage() {
  return (
    <AuthGuard>
      <JobsManager />
    </AuthGuard>
  );
}
