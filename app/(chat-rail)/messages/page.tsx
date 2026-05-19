/**
 * @fileType page
 * @domain kody
 * @pattern messages-page
 * @ai-summary Team messaging entry point. Renders the channel rail + thread
 *   pane inside the shared chat-rail shell (AuthGuard handled by the route
 *   group layout). Channels are GitHub Discussions; messages fan out to
 *   push/Slack/inbox via the existing mention-dispatch path.
 */
import { MessagesView } from "@dashboard/lib/components/MessagesView";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Messages — Kody Operations Dashboard",
  description:
    "Team chat over GitHub Discussions — @mentions notify teammates via push, Slack, and the inbox.",
  path: "/messages",
});

export default function MessagesPage() {
  return (
    <div className="p-4">
      <MessagesView />
    </div>
  );
}
