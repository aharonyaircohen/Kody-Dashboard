/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../../metadata";

export const metadata = buildKodyMetadata({
  title: "Brand - Kody Operations Dashboard",
  description: "View a selected client chat brand.",
  path: "/brands",
});
export const dynamic = "force-dynamic";

export { default } from "@kody-ade/kody-chat/pages/brand-detail";
