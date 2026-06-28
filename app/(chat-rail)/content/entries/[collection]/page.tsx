import { CmsManager } from "@dashboard/lib/components/CmsManager";
import { buildKodyMetadata } from "../../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Content Collection - Kody Operations Dashboard",
  description: "Browse a selected configured content collection.",
  path: "/content/entries",
});

export default async function ContentCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  return <CmsManager selectedCollectionName={decodeURIComponent(collection)} />;
}
