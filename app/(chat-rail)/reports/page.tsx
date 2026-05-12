/**
 * @fileType page
 * @domain kody
 * @pattern redirect
 * @ai-summary Reports moved under the Jobs page (as the "Job Reports" tab).
 *   This route forwards old links to `/jobs?tab=reports`.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-static";

export default function ReportsRedirect() {
  redirect("/jobs?tab=reports");
}
