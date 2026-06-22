/**
 * @fileType page
 * @domain context
 * @pattern context-page
 * @ai-summary Context CRUD entry point. Manages free-form markdown files
 *   stored at `.kody/context/<slug>.md`. Entries owned by the built-in
 *   `kody` agent are injected into the kody-direct chat system prompt so the
 *   agent knows what the company is and does.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ContextControl } from "@dashboard/lib/components/ContextControl";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Context — Kody Operations Dashboard",
  description: "Curated markdown context you feed Kody, attached to agent.",
  path: "/context",
});

export default function ContextPage() {
  return (
    <AuthGuard>
      <ContextControl />
    </AuthGuard>
  );
}
