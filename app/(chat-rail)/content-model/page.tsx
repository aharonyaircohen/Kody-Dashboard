import { ContentModelManager } from "@dashboard/lib/components/ContentModelManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Content Model - Kody Operations Dashboard",
  description: "Design CMS resources and fields stored in Kody state.",
  path: "/content-model",
});

export default function ContentModelPage() {
  return <ContentModelManager />;
}
