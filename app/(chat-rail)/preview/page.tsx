/**
 * @fileType page
 * @domain preview
 * @pattern preview-page
 * @ai-summary Standalone Preview workspace — the full Vibe preview (iframe,
 *   Web/Admin views, device sizes, element inspector → chat) with a named
 *   environment switcher (Production / Staging / Dev …), independent of any
 *   task. AuthGuard comes from the (chat-rail) group; the shared header sits
 *   above via the shell.
 */
import { PreviewWorkspace } from "@dashboard/lib/components/PreviewWorkspace";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Preview — Kody Operations Dashboard",
  description:
    "Live preview of any environment — Production, Staging, Dev — with views, device sizes, and element-pick into chat.",
  path: "/preview",
});

export default function PreviewPage() {
  return <PreviewWorkspace />;
}
