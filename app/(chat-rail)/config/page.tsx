/**
 * @fileType page
 * @domain config
 * @pattern repo-config-page
 * @ai-summary Repo-scoped engine config entry point (/config). Edits the
 *   kody.config.json fields that affect the whole repo — operators, quality
 *   commands, access gate, default branch, aliases. Separate from /company,
 *   which is only bundle import/export.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { RepoConfigManager } from "@dashboard/lib/components/RepoConfigManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Config",
  description:
    "Repo-wide engine config: operators, quality commands, access gate, default branch, aliases.",
  path: "/config",
});

export default function ConfigPage() {
  return (
    <AuthGuard>
      <RepoConfigManager />
    </AuthGuard>
  );
}
