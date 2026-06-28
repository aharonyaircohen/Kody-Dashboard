import { redirect } from "next/navigation";

export default async function CmsCreateRoute({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const { collection } = await params;
  redirect(
    `/content/entries/new/${encodeURIComponent(decodeURIComponent(collection))}`,
  );
}
