/**
 * @fileType page
 * @domain client-chat
 * @pattern languages-page
 * @ai-summary Client language registry entry point. Manages language JSON
 *   files stored at `languages/<code>.json` in the state repo.
 */
import { LanguagesManager } from "@kody-ade/kody-chat/components/LanguagesManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Languages — Kody Operations Dashboard",
  description: "Manage client chat translations.",
  path: "/languages",
});

export default function LanguagesPage() {
  return <LanguagesManager />;
}
