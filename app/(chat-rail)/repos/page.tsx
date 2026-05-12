/**
 * @fileType page
 * @domain kody
 * @pattern multi-repo-page
 * @ai-summary Repositories management entry point. Lets users add additional
 *   GitHub repos (each with its own PAT) and switch the current repo viewed
 *   in the dashboard. Renders inside the shared PageWithChat shell.
 */
import { RepoManager } from "@dashboard/lib/components/RepoManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Repositories — Kody Operations Dashboard",
  description:
    "Manage the GitHub repositories connected to the Kody dashboard. Each repo carries its own PAT and can be set as the current view.",
  path: "/repos",
});

export default function ReposPage() {
  return <RepoManager />;
}
