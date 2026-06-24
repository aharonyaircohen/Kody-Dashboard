/**
 * @fileType page
 * @domain runner
 * @pattern fly-machines-page
 * @ai-summary Fly live machines page: current machine inventory and actions.
 */
import { RunnerManager } from "@dashboard/lib/components/RunnerManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Machines — Kody Operations Dashboard",
  description: "View and manage live Fly machines.",
  path: "/fly/machines",
});

export default function FlyMachinesPage() {
  return <RunnerManager view="machines" />;
}
