/**
 * @fileType page
 * @domain kody
 * @pattern job-control-page
 * @ai-summary Job Control entry point. Renders under AuthGuard like the main dashboard.
 */
import { JobControl } from "@dashboard/lib/components/JobControl";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Job Control — Kody Operations Dashboard",
  description: "Manage Kody jobs: intent, system prompt, allowed commands, and restrictions.",
  path: "/jobs",
});

export default function JobsPage() {
  return <JobControl />;
}
