/**
 * @fileType page
 * @domain kody
 * @pattern trust-page
 * @ai-summary Trust entry point. Renders the staff trust-ledger manager inside
 *   the shared chat-rail layout so the assistant stays available. The page is
 *   where an operator sees how close each staff member is to acting on its own
 *   and grants/revokes that autonomy by hand.
 */
import { TrustManager } from "@dashboard/lib/components/TrustManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Trust",
  description:
    "See how close each staff member is to acting on its own, and grant or revoke that autonomy per action.",
  path: "/trust",
});

export default function TrustPage() {
  return <TrustManager />;
}
