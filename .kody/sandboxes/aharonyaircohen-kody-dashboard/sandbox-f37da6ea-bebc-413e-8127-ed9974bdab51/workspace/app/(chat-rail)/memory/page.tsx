/**
 * @fileType page
 * @domain kody
 * @pattern memory-page
 * @ai-summary Kody memory management page. Lets operators create, edit,
 *   search, and delete `.kody/memory/<id>.md` files.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard";
import { MemoryManager } from "@dashboard/lib/components/MemoryManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Memory — Kody Operations Dashboard",
  description: "Manage persistent Kody memory.",
  path: "/memory",
});

export default function MemoryPage() {
  return (
    <AuthGuard>
      <MemoryManager />
    </AuthGuard>
  );
}
