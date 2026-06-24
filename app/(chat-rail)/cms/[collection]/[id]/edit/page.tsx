import { CmsEditManager } from "@dashboard/lib/components/CmsManager";

import { buildKodyMetadata } from "../../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "CMS - Kody Operations Dashboard",
  description: "Edit configured CMS content from Kody state.",
  path: "/cms",
});

export default async function CmsEditRoute({
  params,
}: {
  params: Promise<{ collection: string; id: string }>;
}) {
  const { collection, id } = await params;

  return (
    <CmsEditManager
      collectionName={decodeURIComponent(collection)}
      documentId={decodeURIComponent(id)}
    />
  );
}
