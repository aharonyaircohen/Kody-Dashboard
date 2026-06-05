/**
 * @fileType page
 * @domain instructions
 * @pattern instructions-page
 * @ai-summary Per-repo chat instructions editor. Stores
 *   `.kody/instructions.md`, appended to every kody-direct chat
 *   turn so users can override tone / length / formatting.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { InstructionsManager } from "@dashboard/lib/components/InstructionsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Instructions",
  description:
    "Per-repo chat instructions that override the base agent prompt.",
  path: "/instructions",
});

export default function InstructionsPage() {
  return (
    <AuthGuard>
      <InstructionsManager />
    </AuthGuard>
  );
}
