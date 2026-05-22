/**
 * @fileType page
 * @domain company
 * @pattern company-page
 * @ai-summary Company import/export entry point. Exports the repo's
 *   portable operating manual (staff, duties, prompts, instructions) as a
 *   JSON bundle and imports one into another repo. Also hosts the one-time
 *   legacy `.kody/jobs|workers` → `duties|staff` folder migration.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { CompanyManager } from "@dashboard/lib/components/CompanyManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Company — Kody Operations Dashboard",
  description: "Import and export a company: staff, duties, prompts, instructions.",
  path: "/company",
});

export default function CompanyPage() {
  return (
    <AuthGuard>
      <CompanyManager />
    </AuthGuard>
  );
}
