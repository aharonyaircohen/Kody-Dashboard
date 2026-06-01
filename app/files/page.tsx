/**
 * @fileType page
 * @domain kody
 * @pattern files-page
 * @ai-summary Files browser entry point - browse, search, and edit repository files
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { FilesProvider } from "@dashboard/lib/components/files/FilesContext";
import { FilesManager } from "@dashboard/lib/components/files/FilesManager";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Files — Kody Operations Dashboard",
  description: "Browse, search, and edit repository files",
  path: "/files",
});

export default function FilesPage() {
  return (
    <AuthGuard>
      <FilesProvider>
        <div className="h-[calc(100vh-4rem)]">
          <FilesManager />
        </div>
      </FilesProvider>
    </AuthGuard>
  );
}
