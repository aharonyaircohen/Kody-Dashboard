/**
 * @fileType util
 * @domain company-store
 * @pattern store-asset-resolution
 * @ai-summary Read-only company-store asset helpers. Runtime Kody resolves
 *   consumer repo assets first, then kody-company-store, then engine built-ins;
 *   dashboard mirrors the store layer without copying files into the repo.
 */

import type { Octokit } from "@octokit/rest";
import { getStoreRef, getStoreRepoUrl } from "../github-client";

export type StoreAssetKind =
  | "capabilities"
  | "implementations"
  | "workflows"
  | "commands"
  | "goals"
  | "agent"
  | "agents";
type StoreManifestKind =
  | "capabilities"
  | "implementations"
  | "workflows"
  | "commands"
  | "goals"
  | "agent";
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
      StoreManifestKind,
      {
        selected?: Record<string, StoreManifestAsset>;
      }
    >
  >;
}

interface StoreConfig {
  assetRoots?: Record<string, unknown>;
}

const DEFAULT_COMPANY_STORE = "aharonyaircohen/kody-company-store";
const DEFAULT_COMPANY_STORE_REF = "main";

let manifestMemo: { key: string; value: Promise<StoreManifest | null> } | null =
  null;
let configMemo: { key: string; value: Promise<StoreConfig | null> } | null =
  null;

function getCompanyStoreRef(): string {
  return (
    getStoreRef()?.trim() ||
    process.env.KODY_COMPANY_STORE_REF?.trim() ||
    DEFAULT_COMPANY_STORE_REF
  );
}

function parseStoreReference(
  raw: string,
): { owner: string; repo: string } | null {
  const trimmed = raw
    .trim()
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (trimmed.startsWith("https://github.com/")) {
    const path = trimmed.slice("https://github.com/".length);
    const [owner, repo] = path.split("/", 2);
    if (!owner || !repo) return null;
    return { owner, repo };
  }
  const [owner, repo] = trimmed.split("/", 2);
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function getCompanyStoreTarget(): CompanyStoreTarget {
  const raw =
    getStoreRepoUrl()?.trim() ||
    process.env.KODY_COMPANY_STORE?.trim() ||
    DEFAULT_COMPANY_STORE;
  const parsed = parseStoreReference(raw);
  if (!parsed) {
    return {
      owner: "aharonyaircohen",
      repo: "kody-company-store",
      ref: getCompanyStoreRef(),
    };
  }
  return {
    owner: parsed.owner,
    repo: parsed.repo,
    ref: getCompanyStoreRef(),
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
  return `https://github.com/${store.owner}/${store.repo}/tree/${store.ref}/${defaultStoreAssetRoot(kind)}/${slug}`;
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
    const root = await companyStoreAssetPath(octokit, kind);
    const entries = await readCompanyStoreDirectory(octokit, root);
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
    const root = await companyStoreAssetPath(octokit, kind);
    const entries = await readCompanyStoreDirectory(octokit, root);
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

export async function companyStoreAssetPath(
  octokit: Octokit,
  kind: StoreAssetKind,
  ...segments: string[]
): Promise<string> {
  return joinStorePath(await companyStoreAssetRoot(octokit, kind), ...segments);
}

async function companyStoreAssetRoot(
  octokit: Octokit,
  kind: StoreAssetKind,
): Promise<string> {
  const config = await readCompanyStoreConfig(octokit);
  const manifestKind = storeManifestKind(kind);
  const configured =
    config?.assetRoots?.[manifestKind] ?? config?.assetRoots?.[kind];
  if (typeof configured === "string" && configured.trim()) {
    return cleanStorePath(configured);
  }
  return legacyStoreAssetRoot(kind);
}

function storeManifestKind(kind: StoreAssetKind): StoreManifestKind {
  return kind === "agents" ? "agent" : kind;
}

function defaultStoreAssetRoot(kind: StoreAssetKind): string {
  switch (kind) {
    case "agents":
    case "agent":
      return "agents";
    case "goals":
      return "goals/templates";
    default:
      return kind;
  }
}

function legacyStoreAssetRoot(kind: StoreAssetKind): string {
  switch (kind) {
    case "agents":
    case "agent":
      return ".kody/agents";
    case "goals":
      return ".kody/goals/templates";
    default:
      return `.kody/${kind}`;
  }
}

function joinStorePath(...parts: string[]): string {
  return parts.map(cleanStorePath).filter(Boolean).join("/");
}

function cleanStorePath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, "");
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
  const manifestKind = storeManifestKind(kind);
  const mtime = manifest?.kinds?.[manifestKind]?.selected?.[slug]?.mtime;
  return typeof mtime === "string" && mtime
    ? mtime
    : "1970-01-01T00:00:00.000Z";
}

async function readCompanyStoreConfig(
  octokit: Octokit,
): Promise<StoreConfig | null> {
  const store = getCompanyStoreTarget();
  const key = `${store.owner}/${store.repo}@${store.ref}`;
  if (configMemo?.key === key) return configMemo.value;
  const value = (async () => {
    const raw =
      (await readCompanyStoreText(octokit, "kody-store.json")) ??
      (await readCompanyStoreText(octokit, ".kody/kody-store.json"));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoreConfig;
    } catch {
      return null;
    }
  })();
  configMemo = { key, value };
  return value;
}

async function readCompanyStoreManifest(
  octokit: Octokit,
): Promise<StoreManifest | null> {
  const store = getCompanyStoreTarget();
  const key = `${store.owner}/${store.repo}@${store.ref}`;
  if (manifestMemo?.key === key) return manifestMemo.value;
  const value = (async () => {
    const raw =
      (await readCompanyStoreText(octokit, "store-manifest.json")) ??
      (await readCompanyStoreText(octokit, ".kody/store-manifest.json"));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoreManifest;
    } catch {
      return null;
    }
  })();
  manifestMemo = { key, value };
  return value;
}
