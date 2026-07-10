/**
 * @fileType page
 * @domain client-chat
 * @pattern language-selected-page
 * @ai-summary Selected Language route. Keeps language selection addressable
 *   at `/languages/<code>`.
 */
import { LanguagesManager } from "@kody-ade/kody-chat/components/LanguagesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Language - Kody Operations Dashboard",
  description: "View a selected client chat language pack.",
  path: "/languages",
});

export default async function SelectedLanguagePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <LanguagesManager selectedCode={code} />;
}
