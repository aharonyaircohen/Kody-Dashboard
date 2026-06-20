/**
 * @fileType util
 * @domain kody
 * @pattern staff-files
 * @ai-summary Staff preset over the shared ticked-file store. A staff
 *   member is a `.kody/staff/<slug>.md` file; duties and staff are the
 *   same mechanism, so the implementation lives once in `ticked/files.ts`.
 *   This file binds the staff directory / commit scope / cache and
 *   re-exports the API under the `*StaffFile` names so importers stay
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

/** Alias — duties and staff share the `TickFile` shape. */
export type StaffFile = TickFile;

const impl = createTickedFiles({
  dir: ".kody/staff",
  commitScope: "staff",
  invalidateCache: invalidateStaffCache,
});

export const listStaffFiles = impl.listFiles;
export const readStaffFile = impl.readFile;
export const writeStaffFile = impl.writeFile;
export const deleteStaffFile = impl.deleteFile;
export const isValidSlug = impl.isValidSlug;

export async function listResolvedStaffFiles(): Promise<StaffFile[]> {
  const octokit = getOctokit();
  const local = await listStaffFiles();
  const store = await listStoreStaffFiles(
    octokit,
    new Set(local.map((staff) => staff.slug)),
  );
  return mergeAssetsBySlug(local, store);
}

export async function readResolvedStaffFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<StaffFile | null> {
  const local = await readStaffFile(slug, octokitOverride);
  if (local) return local;
  return readStoreStaffFile(slug, octokitOverride ?? getOctokit());
}

async function listStoreStaffFiles(
  octokit: Octokit,
  localSlugs: Set<string>,
): Promise<StaffFile[]> {
  const slugs = await listCompanyStoreMarkdownAssetSlugs(
    octokit,
    "staff",
    isValidSlug,
  );
  const staff = await Promise.all(
    slugs
      .filter((slug) => !localSlugs.has(slug))
      .map((slug) => readStoreStaffFile(slug, octokit)),
  );
  return staff.filter((member): member is StaffFile => member !== null);
}

async function readStoreStaffFile(
  slug: string,
  octokit: Octokit,
): Promise<StaffFile | null> {
  if (!isValidSlug(slug)) return null;
  const path = `.kody/staff/${slug}.md`;
  const [raw, updatedAt] = await Promise.all([
    readCompanyStoreText(octokit, path),
    companyStoreUpdatedAt(octokit, "staff", slug),
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
    disabled: false,
    runner: null,
    reviewer: null,
    action: null,
    mentions: [],
    executable: null,
    executables: [],
    dutyTools: [],
    tickScript: null,
    readsFrom: [],
    writesTo: [],
    htmlUrl: buildCompanyStoreBlobUrl(path),
    source: "store",
    readOnly: true,
  };
}
