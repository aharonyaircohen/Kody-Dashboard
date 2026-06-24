import { AuthGuard } from "@dashboard/lib/auth-guard";
import { OrgRedirect } from "@dashboard/lib/components/OrgRedirect";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Org — Kody Operations Dashboard",
  description: "Manage repositories attached to an org workspace.",
  path: "/org",
});

export default function OrgIndexPage() {
  return (
    <AuthGuard>
      <OrgRedirect />
    </AuthGuard>
  );
}
