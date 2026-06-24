/**
 * @fileType page
 * @domain runner
 * @pattern fly-config-page
 * @ai-summary Fly configuration page: token status, preview settings, runner
 * sizing, and Brain-on-Fly settings.
 */
import { RunnerManager } from "@dashboard/lib/components/RunnerManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Config — Kody Operations Dashboard",
  description: "Configure Fly previews, task runners, and Brain-on-Fly.",
  path: "/fly/config",
});

export default function FlyConfigPage() {
  return <RunnerManager view="config" />;
}
