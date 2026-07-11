/**
 * @fileType api-endpoint
 * @domain client-chat
 * @pattern languages-api
 * @ai-summary Language registry API — thin re-export of the package-owned
 *   handlers (@kody-ade/kody-chat).
 */
export { GET, POST } from "@kody-ade/kody-chat/routes/kody/languages";

// Next.js route-segment config can't be re-exported — declare it literally
// (mirrors the package route's own values).
export const dynamic = "force-dynamic";
export const revalidate = 0;
