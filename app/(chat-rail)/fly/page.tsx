/**
 * @fileType page
 * @domain runner
 * @pattern fly-index-redirect
 * @ai-summary Fly area root redirects to Fly Config.
 */
import { redirect } from "next/navigation";

export default function FlyPage() {
  redirect("/fly/config");
}
