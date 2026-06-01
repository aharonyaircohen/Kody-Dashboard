/**
 * @fileType page
 * @domain kody
 * @pattern staff-page
 * @ai-summary Staff entry point. Renders a tabbed shell hosting Staff
 *   Control under a single route. Mirrors the Duties page; starts empty
 *   (no duties are copied — `.kody/staff/` is its own directory).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { StaffPageTabs } from "@dashboard/lib/components/StaffPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Staff",
  description: "Manage Kody staff.",
  path: "/staff",
});

export default function StaffPage() {
  return (
    <AuthGuard>
      <StaffPageTabs />
    </AuthGuard>
  );
}
