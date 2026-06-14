/**
 * @fileType page
 * @domain kody
 * @pattern activity-page
 * @ai-summary Activity entry point — engine run health for the connected
 *   repo (queue depth, throughput, failures, recent runs). Static shell;
 *   data is fetched client-side and polled.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ActivityPage } from "@dashboard/lib/components/ActivityPage";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Activity — Kody Operations Dashboard",
  description:
    "Engine run health: queue depth, throughput, failures, and recent runs.",
  path: "/activity",
});

export default function ActivityRoute() {
  return (
    <AuthGuard>
      <ActivityPage />
    </AuthGuard>
  );
}
