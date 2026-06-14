/**
 * @fileType page
 * @domain kody
 * @pattern duties-page
 * @ai-summary Duties entry point. Renders the duty list (legacy functional DutyControl). No tabs; Reports
 *   have their own route (/reports).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DutiesPageTabs } from "@dashboard/lib/components/DutiesPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Duties — Kody Operations Dashboard",
  description: "Manage Kody duties and review their reports.",
  path: "/duties",
});

export default function DutiesPage() {
  return (
    <AuthGuard>
      <DutiesPageTabs />
    </AuthGuard>
  );
}
