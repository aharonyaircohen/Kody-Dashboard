/**
 * @fileType page
 * @domain kody
 * @pattern launcher-page
 * @ai-summary Root launcher. Redirects to the user's last primary view
 *   (chat or tasks) via PrimaryViewRedirect. Force static for OG tags —
 *   social media crawlers need metadata without auth.
 */
import { PrimaryViewRedirect } from "@dashboard/lib/components/PrimaryViewRedirect";

// Force static generation so OG tags are available without authentication
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

// Root page uses the layout default title "Kody Operations Dashboard" (no template applied)
// The description and other metadata are inherited from the layout as well.

// `/` is just a launcher: it bounces to the user's last view (chat or tasks),
// stored per-device in localStorage. Switch the default by changing the
// fallback in readPrimaryView (ViewToggle.tsx).
export default async function KodyPage() {
  return <PrimaryViewRedirect />;
}
