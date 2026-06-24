import { CmsCreateManager } from "@dashboard/lib/components/CmsManager";

import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "CMS - Kody Operations Dashboard",
  description: "Create configured CMS content from Kody state.",
  path: "/cms",
});

export default async function CmsCreateRoute({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;

  return <CmsCreateManager collectionName={decodeURIComponent(collection)} />;
}
