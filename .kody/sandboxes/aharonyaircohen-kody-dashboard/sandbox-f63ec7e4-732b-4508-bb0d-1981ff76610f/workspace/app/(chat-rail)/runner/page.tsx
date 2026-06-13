/**
 * @fileType page
 * @domain runner
 * @pattern runner-page
 * @ai-summary Per-repo Fly runner configuration entry point. Renders inside
 *   PageWithChat so the assistant is always available.
 */
import { RunnerManager } from "@dashboard/lib/components/RunnerManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Fly Runner — Kody Operations Dashboard",
  description:
    "Per-repo Fly infrastructure: runner machines, previews, and Brain-on-Fly.",
  path: "/runner",
});

export default function RunnerPage() {
  return <RunnerManager />;
}
