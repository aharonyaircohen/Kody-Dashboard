/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Tasks view — the operations dashboard (pipelines, tasks, runs).
 *   Lives at /tasks; the chat assistant is the sibling primary view at /chat.
 *   Force static for OG tags — social media crawlers need metadata without auth.
 */
import { AuthGate } from "@dashboard/lib/components/AuthGate";
import { buildKodyMetadata } from "../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Tasks — Kody Operations Dashboard",
  description:
    "Monitor and manage AI coding agent tasks, pipelines, and deployments",
  path: "/tasks",
});

export default async function TasksPage() {
  return <AuthGate />;
}
