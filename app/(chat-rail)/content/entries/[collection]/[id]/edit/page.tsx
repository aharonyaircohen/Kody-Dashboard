import { CmsEditManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Edit Content Entry - Kody Operations Dashboard",
  description: "Edit configured content from Kody state.",
  path: "/content/entries",
});

export default async function ContentEntryEditPage({
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
