import { redirect } from "next/navigation";
import { buildKodyMetadata } from "../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Capabilities — Kody Operations Dashboard",
  description: "Manage reusable Kody capabilities.",
  path: "/jobs",
});

export default function JobsPage() {
  redirect("/capabilities");
}
