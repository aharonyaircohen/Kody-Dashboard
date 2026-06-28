import { CmsConfigManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Content Settings - Kody Operations Dashboard",
  description: "Configure content adapter, schema, permissions, and MCP.",
  path: "/content/settings",
});

export default function ContentSettingsPage() {
  return <CmsConfigManager />;
}
