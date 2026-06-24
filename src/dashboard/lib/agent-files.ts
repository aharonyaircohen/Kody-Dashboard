/**
 * @fileType util
 * @domain kody
 * @pattern agent-files
 * @ai-summary Agent preset over the shared ticked-file store. An agent
 *   member is a `.kody/agents/<slug>.md` file; agentResponsibilities and agent are the
 *   same mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the agent directory / commit scope / cache and
 *   re-exports the API under the `*AgentFile` names so importers stay
 *   stable.
 */

import type { Octokit } from "@octokit/rest";
import { getOctokit, invalidateStaffCache } from "./github-client";
import {
  buildCompanyStoreBlobUrl,
  companyStoreUpdatedAt,
  listCompanyStoreMarkdownAssetSlugs,
  mergeAssetsBySlug,
  readCompanyStoreText,
} from "./company-store/assets";
import {
  createTickedFiles,
  parseTickedMarkdown,
  type TickFile,
} from "./ticked/files";

/** Alias — agentResponsibilities and agent share the `TickFile` shape. */
export type AgentFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/agents",
  commitScope: "agent",
  invalidateCache: invalidateStaffCache,
});

export const listAgentFiles = impl.listFiles;
export const readAgentFile = impl.readFile;
export const writeAgentFile = impl.writeFile;
export const deleteAgentFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;

export async function listResolvedAgentFiles(): Promise<AgentFile[]> {
  const octokit = getOctokit();
  const local = await listAgentFiles();
  const store = await listStoreAgentFiles(
    octokit,
    new Set(local.map((agent) => agent.slug)),
  );
  return mergeAssetsBySlug(local, store);
}

export async function readResolvedAgentFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<AgentFile | null> {
  const local = await readAgentFile(slug, octokitOverride);
  if (local) return local;
  return readStoreAgentFile(slug, octokitOverride ?? getOctokit());
}

async function listStoreAgentFiles(
  octokit: Octokit,
  localSlugs: Set<string>,
): Promise<AgentFile[]> {
  const slugs = await listCompanyStoreMarkdownAssetSlugs(
    octokit,
    "agents",
    isValidSlug,
  );
  const agent = await Promise.all(
    slugs
      .filter((slug) => !localSlugs.has(slug))
      .map((slug) => readStoreAgentFile(slug, octokit)),
  );
  return agent.filter((member): member is AgentFile => member !== null);
}

async function readStoreAgentFile(
  slug: string,
  octokit: Octokit,
): Promise<AgentFile | null> {
  if (!isValidSlug(slug)) return null;
  const path = `.kody/agents/${slug}.md`;
  const [raw, updatedAt] = await Promise.all([
    readCompanyStoreText(octokit, path),
    companyStoreUpdatedAt(octokit, "agents", slug),
  ]);
  if (raw === null) return null;
  const { title, body } = parseTickedMarkdown(raw, slug);
  return {
    slug,
    title,
    body,
    sha: "",
    updatedAt,
    lastTickAt: null,
    nextEligibleAt: null,
    lastOutcome: null,
    lastDurationMs: null,
schedule: null,
capabilityKind: null,
    disabled: false,
    agent: null,
    reviewer: null,
    action: null,
    mentions: [],
    agentAction: null,
    agentActions: [],
    agentResponsibilityTools: [],
    tickScript: null,
    readsFrom: [],
    writesTo: [],
    htmlUrl: buildCompanyStoreBlobUrl(path),
    source: "store",
    readOnly: true,
  };
}
