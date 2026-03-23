/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with task detail on Comments tab via URL /[n]/comments.
 *   Force static with generateStaticParams for OG tags.
 */
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildTaskMetadata } from "../../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

// Pre-render common issue numbers at build time for OG tags
export async function generateStaticParams() {
  const issueNumbers = Array.from({ length: 50 }, (_, i) => ({
    issueNumber: String(i + 800),
  }));
  return issueNumbers;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ issueNumber: string }>;
}): Promise<Metadata> {
  const { issueNumber } = await params;
  const parsed = parseInt(issueNumber, 10);
  if (isNaN(parsed)) return { title: "Kody Operations Dashboard" };
  return buildTaskMetadata(parsed, {
    suffix: "Comments",
    path: `/${parsed}/comments`,
  });
}

export default async function KodyTaskCommentsPage({
  params,
}: {
  params: Promise<{ issueNumber: string }>;
}) {
  const { issueNumber } = await params;
  const parsed = parseInt(issueNumber, 10);

  if (isNaN(parsed)) {
    redirect("/");
  }

  return <KodyDashboard initialIssueNumber={parsed} />;
}
