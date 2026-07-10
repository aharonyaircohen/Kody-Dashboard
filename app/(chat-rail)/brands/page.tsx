/**
 * @fileType page
 * @pattern package-page-reexport
 * @ai-summary This URL serves the canonical shared page from
 *   @kody-ade/kody-chat — this file only registers the route (and keeps
 *   the dashboard's own metadata / caching directives).
 */
import { buildKodyMetadata } from "../../metadata";

export const metadata = buildKodyMetadata({
  title: "Brands — Kody Operations Dashboard",
  description: "Manage client chat brands.",
  path: "/brands",
});
export const dynamic = "force-dynamic";

export { default } from "@kody-ade/kody-chat/pages/brands";
