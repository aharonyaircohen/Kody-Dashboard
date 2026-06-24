/**
 * @fileType page
 * @domain runner
 * @pattern fly-history-page
 * @ai-summary Fly history page: machine activity snapshots and cost estimates.
 */
import { RunnerManager } from "@dashboard/lib/components/RunnerManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly History — Kody Operations Dashboard",
  description: "Review Fly machine activity snapshots and estimated cost.",
  path: "/fly/history",
});

export default function FlyHistoryPage() {
  return <RunnerManager view="history" />;
}
