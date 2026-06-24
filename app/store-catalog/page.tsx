/**
 * @fileType page
 * @domain kody
 * @pattern store-catalog-page
 * @ai-summary Browse shared store items and activate repo references.
 */

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { StoreCatalogManager } from "@dashboard/lib/components/StoreCatalogManager";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Store Catalog - Kody Operations Dashboard",
  description: "Browse shared Kody store items.",
  path: "/store-catalog",
});

export default function StoreCatalogPage() {
  return (
    <AuthGuard>
      <StoreCatalogManager />
    </AuthGuard>
  );
}
