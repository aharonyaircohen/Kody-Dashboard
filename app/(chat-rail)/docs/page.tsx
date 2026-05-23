/**
 * @fileType page
 * @domain docs
 * @pattern docs-page
 * @ai-summary Documentation CRUD entry point. Manages free-form markdown
 *   files stored at `.kody/docs/<slug>.md`. Docs owned by the built-in
 *   `kody` staff are injected into the kody-direct chat system prompt so the
 *   agent knows what the company is and does.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DocsControl } from "@dashboard/lib/components/DocsControl";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Documentation — Kody Operations Dashboard",
  description: "Markdown docs that describe your company and brief your staff.",
  path: "/docs",
});

export default function DocsPage() {
  return (
    <AuthGuard>
      <DocsControl />
    </AuthGuard>
  );
}
