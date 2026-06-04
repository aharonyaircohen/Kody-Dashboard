/**
 * @fileType page
 * @domain docs
 * @pattern docs-page
 * @ai-summary Docs entry point. Renders README.md + docs/*.md from the
 *   connected repo, listed in a left sidebar with markdown rendering on
 *   the right. Read-only; docs are maintained in PRs.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { DocsView } from "@dashboard/lib/components/DocsView";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Docs — Kody Operations Dashboard",
  description: "Project documentation: README and docs folder.",
  path: "/docs",
});

export default function DocsPage() {
  return (
    <AuthGuard>
      <DocsView />
    </AuthGuard>
  );
}
