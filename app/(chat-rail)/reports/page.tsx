/**
 * @fileType page
 * @domain kody
 * @pattern redirect
 * @ai-summary Reports moved under the Duties page (as the "Duty Reports" tab).
 *   This route forwards old links to `/duties?tab=reports`.
 */
import { redirect } from "next/navigation";

export const dynamic = "force-static";

export default function ReportsRedirect() {
  redirect("/duties?tab=reports");
}
