import { CmsManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Content Entries - Kody Operations Dashboard",
  description: "Read configured content collections from Kody state.",
  path: "/content/entries",
});

export default function ContentEntriesPage() {
  return <CmsManager />;
}
