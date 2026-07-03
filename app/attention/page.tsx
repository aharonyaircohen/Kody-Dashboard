/**
 * @fileType page
 * @domain kody
 * @pattern attention-page
 * @ai-summary Alias route for the attention home surface so the side-panel
 *   Views group can link to Attention without replacing the fixed Dashboard
 *   home link at `/`.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DashboardHome } from "@dashboard/lib/components/DashboardHome";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Attention",
  description: "See what needs attention, what is running, and what finished.",
  path: "/attention",
});

export default function AttentionPage() {
  return (
    <AuthGuard>
      <DashboardHome />
    </AuthGuard>
  );
}
