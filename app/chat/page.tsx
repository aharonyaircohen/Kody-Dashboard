/**
 * @fileType page
 * @domain kody
 * @pattern chat-page
 * @ai-summary Chat is the primary assistant view. The page itself renders
 *   nothing — the single persistent KodyChat lives in ChatRailShell and is
 *   shown full-pane when the route is /chat (so history/streaming survive
 *   navigation). This page exists only to own the /chat route + its metadata.
 *   Force static for OG tags - social media crawlers need metadata without auth.
 */
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
  // Chat is rendered by ChatRailShell (the persistent mount). This page pane
  // is hidden on /chat, so it renders nothing.
  return null;
}
