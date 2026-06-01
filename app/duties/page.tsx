/**
 * @fileType page
 * @domain kody
 * @pattern duties-page
 * @ai-summary Duties entry point. Renders a tabbed shell hosting Duty Control
 *   and Reports under a single route. Tab persisted via `?tab=` query string.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DutiesPageTabs } from "@dashboard/lib/components/DutiesPageTabs";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Duties",
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
