/**
 * @fileType page
 * @domain kody
 * @pattern launcher-page
 * @ai-summary Root launcher. Redirects to the user's last primary view
 *   (chat or tasks) via PrimaryViewRedirect. Force static for OG tags —
 *   social media crawlers need metadata without auth.
 */
import { PrimaryViewRedirect } from "@dashboard/lib/components/PrimaryViewRedirect";
import { buildKodyMetadata } from "./metadata";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Kody",
  description:
    "Monitor and manage AI coding agent tasks, pipelines, and deployments",
  path: "/",
});

// `/` is just a launcher: it bounces to the user's last view (chat or tasks),
// stored per-device in localStorage. Switch the default by changing the
// fallback in readPrimaryView (ViewToggle.tsx).
export default async function KodyPage() {
  return <PrimaryViewRedirect />;
}
