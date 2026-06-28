import { CmsCreateManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "New Content Entry - Kody Operations Dashboard",
  description: "Create configured content from Kody state.",
  path: "/content/entries",
});

export default async function ContentEntryCreatePage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;

  return <CmsCreateManager collectionName={decodeURIComponent(collection)} />;
}
