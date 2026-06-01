/**
 * @fileType page
 * @domain files
 * @pattern files-page
 * @ai-summary File browser page at /files — full-featured file viewer and editor.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { FilesManager } from "@dashboard/lib/components/FilesManager";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Files — Kody Operations Dashboard",
  description:
    "Browse, view, edit, and manage files in your repository with a Monaco-powered editor.",
  path: "/files",
});

export default function FilesPage() {
  return (
    <AuthGuard>
      <FilesManager />
    </AuthGuard>
  );
}
