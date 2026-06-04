/**
 * @fileType page
 * @domain kody
 * @pattern notifications-page
 * @ai-summary Notifications management entry point. Renders inside the
 *   shared PageWithChat shell so the assistant is always available.
 */
import { NotificationsManager } from "@dashboard/lib/components/NotificationsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Notifications",
  description: "Manage Slack notification rules for releases and other events.",
  path: "/notifications",
});

export default function NotificationsPage() {
  return <NotificationsManager />;
}
