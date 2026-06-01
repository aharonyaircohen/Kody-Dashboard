/**
 * @fileType page
 * @domain kody
 * @pattern inbox-page
 * @ai-summary Inbox entry point. Renders the per-repo mention list inside
 *   the shared chat-rail layout so the assistant stays available.
 */
import { InboxList } from "@dashboard/lib/components/InboxList";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Inbox",
  description:
    "Durable list of GitHub @mentions and review requests for the active repo, backed by a private gist on your account.",
  path: "/inbox",
});

export default function InboxPage() {
  return <InboxList />;
}
