/**
 * @fileType page
 * @domain kody
 * @pattern workers-page
 * @ai-summary Workers entry point. Renders a tabbed shell hosting Worker
 *   Control under a single route. Mirrors the Jobs page; starts empty
 *   (no jobs are copied — `.kody/workers/` is its own directory).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { WorkersPageTabs } from "@dashboard/lib/components/WorkersPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Workers — Kody Operations Dashboard",
  description: "Manage Kody workers.",
  path: "/workers",
});

export default function WorkersPage() {
  return (
    <AuthGuard>
      <WorkersPageTabs />
    </AuthGuard>
  );
}
