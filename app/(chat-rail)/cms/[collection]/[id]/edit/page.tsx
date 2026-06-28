import { redirect } from "next/navigation";

export default async function CmsEditRoute({
  params,
}: {
  params: Promise<{ collection: string; id: string }>;
}) {
  const { collection, id } = await params;
  redirect(
    `/content/entries/${encodeURIComponent(
      decodeURIComponent(collection),
    )}/${encodeURIComponent(decodeURIComponent(id))}/edit`,
  );
}
