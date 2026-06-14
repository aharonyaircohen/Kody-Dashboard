/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with a specific task pre-selected via URL.
 *   The listed numeric params get prerendered at build time for OG tags;
 *   any other numeric issue renders on demand. We deliberately do NOT
 *   use `force-static` here — it caused Next.js to bake `/vibe` (and
 *   any other non-numeric sibling-route path) into a cached 307 redirect
 *   at the edge, silently shadowing the real static routes for ~5min
 *   stale-time windows. The runtime `notFound()` for non-numeric segments
 *   makes the catch-all decline gracefully so sibling routes (vibe, duties,
 *   settings, …) win at routing.
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildTaskMetadata } from "../metadata";

// Do not guess issue numbers at build time. Numeric params render on demand.
export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ issueNumber: string }>;
}): Promise<Metadata> {
  const { issueNumber } = await params;
  const parsed = parseInt(issueNumber, 10);
  if (isNaN(parsed)) return { title: "Kody Operations Dashboard" };
  return buildTaskMetadata(parsed);
}

export default async function KodyTaskPage({
  params,
}: {
  params: Promise<{ issueNumber: string }>;
}) {
  const { issueNumber } = await params;
  // Only numeric segments are real issues. For any non-numeric segment
  // (e.g. "vibe", "duties", "settings") we must 404, not redirect — a
  // cached `force-static` redirect here shadows sibling static routes
  // at the edge and silently sends users to /. notFound() lets Next.js
  // prefer the matching sibling page (e.g. app/vibe/page.tsx).
  const parsed = parseInt(issueNumber, 10);
  if (isNaN(parsed) || !/^\d+$/.test(issueNumber)) {
    notFound();
  }

  return <KodyDashboard initialIssueNumber={parsed} />;
}
