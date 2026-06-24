/**
 * @fileType page
 * @domain runner
 * @pattern runner-redirect
 * @ai-summary Old Fly Runner URL kept as a redirect to the new Fly Config page.
 */
import { redirect } from "next/navigation";

export default function RunnerPage() {
  redirect("/fly/config");
}
