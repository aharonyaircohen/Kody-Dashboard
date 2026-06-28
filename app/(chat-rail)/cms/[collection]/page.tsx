import { redirect } from "next/navigation";

export default async function CmsCollectionPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  redirect(
    `/content/entries/${encodeURIComponent(decodeURIComponent(collection))}`,
  );
}
