/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Instructions — Kody Operations Dashboard",
  description:
    "Per-repo chat instructions that override the base agent prompt.",
  path: "/instructions",
});
export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

import InstructionsPage from "@kody-ade/kody-chat/pages/instructions";
import { SystemPromptOverrideCard } from "@dashboard/lib/components/SystemPromptOverrideCard";

export default function InstructionsWithSystemPrompt() {
  return (
    <>
      <InstructionsPage />
      <div className="mx-auto w-full max-w-4xl px-4 pb-8">
        <SystemPromptOverrideCard />
      </div>
    </>
  );
}
