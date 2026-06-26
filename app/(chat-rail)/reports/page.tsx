/**
 * @fileType page
 * @domain kody
 * @pattern reports-page
 * @ai-summary Reports has its own page (the Capabilities page no longer has tabs).
 *   Renders the standalone ReportsView.
 */
import { ReportsView } from "@dashboard/lib/components/ReportsView";

export default function ReportsPage() {
  return <ReportsView />;
}
