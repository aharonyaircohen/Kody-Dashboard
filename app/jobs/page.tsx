/**
 * @fileType page
 * @domain kody
 * @pattern jobs-page
 * @ai-summary Legacy Jobs entry point. Jobs have been folded into AgentResponsibilities;
 *   keep this route as a redirect so old bookmarks land on the canonical UI.
 */
import { redirect } from "next/navigation";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "AgentResponsibilities — Kody Operations Dashboard",
  description: "Manage Kody agentResponsibilities.",
  path: "/jobs",
});

export default function JobsPage() {
  redirect("/agent-responsibilities");
}
