/**
 * @fileType page
 * @domain kody
 * @pattern jobs-page
 * @ai-summary Legacy Jobs entry point. Jobs have been folded into Duties;
 *   keep this route as a redirect so old bookmarks land on the canonical UI.
 */
import { redirect } from "next/navigation";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Duties — Kody Operations Dashboard",
  description: "Manage Kody duties.",
  path: "/jobs",
});

export default function JobsPage() {
  redirect("/duties");
}
