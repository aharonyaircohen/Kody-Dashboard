/**
 * @fileType util
 * @domain company-store
 * @pattern store-asset-resolution
 * @ai-summary Read-only company-store asset helpers. Runtime Kody resolves
 *   consumer repo assets first, then kody-company-store, then engine built-ins;
 *   dashboard mirrors the store layer without copying files into the repo.
 */

import type { Octokit } from "@octokit/rest";

export type StoreAssetKind = "duties" | "executables" | "staff";
export type AssetSource = "local" | "store";

export interface CompanyStoreTarget {
  owner: string;
  repo: string;
  ref: string;
}

export interface CompanyStoreDirectoryEntry {
  name: string;
  type: string;
}

interface StoreManifestAsset {
  mtime?: unknown;
}

interface StoreManifest {
  kinds?: Partial<
    Record<
      StoreAssetKind,
      {
        selected?: Record<string, StoreManifestAsset>;
      }
    >
  >;
}

const DEFAULT_COMPANY_STORE = "aharonyaircohen/kody-company-store";
const DEFAULT_COMPANY_STORE_REF = "stable";

let manifestMemo: Promise<StoreManifest | null> | null = null;

export function getCompanyStoreTarget(): CompanyStoreTarget {
  const raw = process.env.KODY_COMPANY_STORE?.trim() || DEFAULT_COMPANY_STORE;
  const [owner, repo] = raw.split("/", 2);
  if (!owner || !repo) {
    return {
      owner: "aharonyaircohen",
      repo: "kody-company-store",
      ref: DEFAULT_COMPANY_STORE_REF,
    };
  }
  return {
    owner,
    repo,
    ref:
      process.env.KODY_COMPANY_STORE_REF?.trim() || DEFAULT_COMPANY_STORE_REF,
  };
}

export function mergeAssetsBySlug<T extends { slug: string }>(
  local: T[],
  store: T[],
): T[] {
  const seen = new Set(local.map((asset) => asset.slug));
  return [...local, ...store.filter((asset) => !seen.has(asset.slug))].sort(
    (a, b) => a.slug.localeCompare(b.slug),
  );
}

export function buildCompanyStoreHtmlUrl(
  kind: StoreAssetKind,
  slug: string,
): string {
  const store = getCompanyStoreTarget();
  return `https://github.com/${store.owner}/${store.repo}/tree/${store.ref}/.kody/${kind}/${slug}`;
}

export function buildCompanyStoreBlobUrl(path: string): string {
  const store = getCompanyStoreTarget();
  return `https://github.com/${store.owner}/${store.repo}/blob/${store.ref}/${path}`;
}

export async function readCompanyStoreDirectory(
  octokit: Octokit,
  path: string,
): Promise<CompanyStoreDirectoryEntry[]> {
  const store = getCompanyStoreTarget();
  const { data } = await octokit.repos.getContent({
    owner: store.owner,
    repo: store.repo,
    path,
    ref: store.ref,
  });
  if (!Array.isArray(data)) return [];
  return data.map((entry) => ({ name: entry.name, type: entry.type }));
}

export async function readCompanyStoreText(
  octokit: Octokit,
  path: string,
): Promise<string | null> {
  const store = getCompanyStoreTarget();
  try {
    const { data } = await octokit.repos.getContent({
      owner: store.owner,
      repo: store.repo,
      path,
      ref: store.ref,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return null;
    throw error;
  }
}

export async function listCompanyStoreAssetSlugs(
  octokit: Octokit,
  kind: StoreAssetKind,
  isValidSlug: (slug: string) => boolean,
): Promise<string[]> {
  try {
    const entries = await readCompanyStoreDirectory(octokit, `.kody/${kind}`);
    return entries
      .filter((entry) => entry.type === "dir" && isValidSlug(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    console.warn("[company-store] failed to list store assets", error);
    return [];
  }
}

export async function listCompanyStoreMarkdownAssetSlugs(
  octokit: Octokit,
  kind: StoreAssetKind,
  isValidSlug: (slug: string) => boolean,
): Promise<string[]> {
  try {
    const entries = await readCompanyStoreDirectory(octokit, `.kody/${kind}`);
    return entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".md"))
      .map((entry) => entry.name.slice(0, -".md".length))
      .filter(isValidSlug)
      .sort((a, b) => a.localeCompare(b));
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    console.warn("[company-store] failed to list store markdown assets", error);
    return [];
  }
}

export async function listCompanyStoreDirectorySafe(
  octokit: Octokit,
  path: string,
): Promise<CompanyStoreDirectoryEntry[]> {
  try {
    return await readCompanyStoreDirectory(octokit, path);
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) return [];
    throw error;
  }
}

export async function companyStoreUpdatedAt(
  octokit: Octokit,
  kind: StoreAssetKind,
  slug: string,
): Promise<string> {
  const manifest = await readCompanyStoreManifest(octokit);
  const mtime = manifest?.kinds?.[kind]?.selected?.[slug]?.mtime;
  return typeof mtime === "string" && mtime
    ? mtime
    : "1970-01-01T00:00:00.000Z";
}

async function readCompanyStoreManifest(
  octokit: Octokit,
): Promise<StoreManifest | null> {
  if (manifestMemo) return manifestMemo;
  manifestMemo = (async () => {
    const raw = await readCompanyStoreText(
      octokit,
      ".kody/store-manifest.json",
    );
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoreManifest;
    } catch {
      return null;
    }
  })();
  return manifestMemo;
}
