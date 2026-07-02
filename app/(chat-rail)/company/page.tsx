/**
 * @fileType page
 * @domain company
 * @pattern company-page
 * @ai-summary AI Agency import/export entry point. Exports the repo's
 *   portable operating manual (agent, capabilities, prompts, instructions) as
 *   a JSON bundle and imports one into another repo.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { AgencyArchitect } from "@dashboard/lib/components/AgencyArchitect";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "AI Agency — Kody Operations Dashboard",
  description:
    "Import and export an AI Agency setup: agent, capabilities, commands, instructions.",
  path: "/company",
});

export default function CompanyPage() {
  return (
    <AuthGuard>
      <AgencyArchitect />
    </AuthGuard>
  );
}
