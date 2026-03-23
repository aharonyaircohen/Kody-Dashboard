/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Kody dashboard with chat panel pre-opened via URL /chat.
 *   Force static for OG tags - social media crawlers need metadata without auth.
 */
import { KodyDashboard } from "@dashboard/lib/components/KodyDashboard";
import { buildKodyMetadata } from "../metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Chat — Kody Operations Dashboard",
  description: "Chat with the Kody AI assistant about tasks and architecture",
  path: "/chat",
});

export default async function KodyChatPage() {
  return <KodyDashboard initialModal="chat" />;
}
