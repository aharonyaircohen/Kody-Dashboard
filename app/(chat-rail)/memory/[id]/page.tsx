/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Memory - Kody Operations Dashboard",
  description: "View a selected Kody memory file.",
  path: "/memory",
});
export const dynamic = "force-dynamic";

export { default } from "@kody-ade/kody-chat/pages/memory-detail";
