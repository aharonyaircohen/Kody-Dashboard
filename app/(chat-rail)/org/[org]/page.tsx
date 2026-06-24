import { AuthGuard } from "@dashboard/lib/auth-guard";
import { OrgManager } from "@dashboard/lib/components/OrgManager";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Org — Kody Operations Dashboard",
  description: "Manage repositories attached to an org workspace.",
  path: "/org",
});

export default async function OrgPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  return (
    <AuthGuard>
      <OrgManager org={decodeURIComponent(org)} />
    </AuthGuard>
  );
}
