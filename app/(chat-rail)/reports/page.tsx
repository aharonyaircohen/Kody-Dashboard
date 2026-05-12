/**
 * @fileType page
 * @domain kody
 * @pattern reports-page
 * @ai-summary Reports entry point. Renders inside the shared PageWithChat
 *   shell so the assistant is always available alongside the report list.
 */
import { ReportsView } from "@dashboard/lib/components/ReportsView";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Reports — Kody Operations Dashboard",
  description:
    "System reports produced by Kody jobs (doc-drift, coverage-floor, etc.).",
  path: "/reports",
});

export default function ReportsPage() {
  return <ReportsView />;
}
