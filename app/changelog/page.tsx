/**
 * @fileType page
 * @domain kody
 * @pattern changelog-page
 * @ai-summary Changelog entry point. Renders the connected repo's
 *   CHANGELOG.md, which is maintained automatically by webhook handlers
 *   (append on merged PR, promote on release.published).
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ChangelogView } from "@dashboard/lib/components/ChangelogView";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Changelog",
  description: "Project changelog: every merged PR and published release.",
  path: "/changelog",
});

export default function ChangelogPage() {
  return (
    <AuthGuard>
      <ChangelogView />
    </AuthGuard>
  );
}
