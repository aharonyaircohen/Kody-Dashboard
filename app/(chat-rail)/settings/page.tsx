/**
 * @fileType page
 * @domain settings
 * @pattern settings-page
 * @ai-summary User credentials management entry point. Renders inside
 *   PageWithChat so the assistant is always available.
 */
import { SettingsManager } from "@dashboard/lib/components/SettingsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Settings — Kody Operations Dashboard",
  description:
    "Manage per-browser credentials, local integrations, and sign-out.",
  path: "/settings",
});

export default function SettingsPage() {
  return <SettingsManager />;
}
