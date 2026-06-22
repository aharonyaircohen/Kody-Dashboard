import { CmsManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "CMS - Kody Operations Dashboard",
  description: "Read configured CMS collections from Kody state.",
  path: "/cms",
});

export default function CmsPage() {
  return <CmsManager />;
}
