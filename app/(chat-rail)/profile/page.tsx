/**
 * @fileType page
 * @domain profile
 * @pattern profile-page
 * @ai-summary Company-profile CRUD entry point. Manages free-form
 *   markdown files stored at `.kody/profile/<slug>.md`. Their bodies are
 *   injected into the kody-direct chat system prompt so the agent knows
 *   what the company is and does.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ProfileManager } from "@dashboard/lib/components/ProfileManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Company Profile — Kody Operations Dashboard",
  description: "Describe your company so Kody knows who you are.",
  path: "/profile",
});

export default function ProfilePage() {
  return (
    <AuthGuard>
      <ProfileManager />
    </AuthGuard>
  );
}
