/**
 * @fileType page
 * @domain runner
 * @pattern fly-activity-page
 * @ai-summary Machine activity history (working time, uptime, est. cost) per
 *   Fly machine. Renders inside PageWithChat like the other /runner-family
 *   pages. Data comes from snapshots on the kody-state branch — GitHub-only.
 */
import { FlyActivityPanel } from "@dashboard/lib/components/FlyActivityPanel";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Machine Activity — Kody Operations Dashboard",
  description:
    "Per-machine Fly working time, uptime, and estimated cost from kody-state snapshots.",
  path: "/fly-activity",
});

export default function FlyActivityPage() {
  return <FlyActivityPanel />;
}
