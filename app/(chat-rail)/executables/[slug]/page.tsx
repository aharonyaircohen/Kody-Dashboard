/**
 * @fileType page
 * @domain executables
 * @pattern executables-page
 * @ai-summary Edit one custom executable at `/executables/<slug>`. Its own
 *   route so the browser Back button returns to the executables list.
 *   Rendered dynamically — slugs are repo-defined, so they can't be
 *   pre-generated.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { ExecutableEditorPage } from "@dashboard/lib/components/ExecutablesManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Edit executable",
  description: "Edit a custom @kody executable.",
  path: "/executables",
});

export default async function EditExecutablePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <AuthGuard>
      <ExecutableEditorPage slug={slug} />
    </AuthGuard>
  );
}
