/**
 * @fileType util
 * @domain client-chat
 * @pattern brands-files
 * @ai-summary Read/write operator-managed client brand JSON files under
 *   `brands/<slug>.json` in the resolved Kody state repo. These records feed
 *   `/client/<slug>`, the branding chat plugin, and client-surface chat
 *   defaults enforced by the chat route.
 */

import type { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  getOctokit,
  getOwner,
  getRepo,
  invalidateBrandsCache,
} from "../github-client";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  writeStateText,
} from "../state-repo";
import {
  normalizeClientBrandLocale,
  normalizeClientBrandSlug,
  type ClientBrand,
} from "../client-brand";
import { slugifyTitle } from "../slug";

export interface BrandFile extends ClientBrand {
  source: "repo";
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const BRANDS_DIR = "brands";
const DELETED_BRAND_SUFFIX = ".disabled";
const BRAND_CACHE_TTL_MS = 60_000;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/;

const brandFileSchema = z.object({
  slug: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  accent: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/),
  locale: z.string().trim().max(35).optional(),
  welcomeText: z.string().trim().max(1000).optional(),
  modelId: z.string().trim().min(1).max(160).optional(),
  agentSlug: z.string().trim().min(1).max(80).optional(),
});

type BrandFileInput = z.infer<typeof brandFileSchema>;

interface CacheEntry<T> {
  data: T;
  expires: number;
  etag?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheEntry<T>(key: string): CacheEntry<T> | null {
  const entry = cache.get(key);
  return entry ? (entry as CacheEntry<T>) : null;
}

function cacheGet<T>(key: string): T | undefined {
  const entry = cacheEntry<T>(key);
  if (!entry || entry.expires <= Date.now()) return undefined;
  return entry.data as T;
}

function cacheSet<T>(key: string, data: T, etag?: string): void {
  cache.set(key, {
    data,
    expires: Date.now() + BRAND_CACHE_TTL_MS,
    etag,
  });
}

function invalidateLocalBrandCache(slug?: string): void {
  if (slug) {
    cache.delete(`brand:${getOwner()}:${getRepo()}:${slug}`);
  }
  cache.delete(`brands:${getOwner()}:${getRepo()}`);
  cache.delete(`brands-deleted:${getOwner()}:${getRepo()}`);
}

function slugFromName(name: string): string | null {
  if (!name.endsWith(".json")) return null;
  const slug = name.slice(0, -".json".length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_")) {
    return null;
  }
  return normalizeClientBrandSlug(slug);
}

function slugFromDeletedName(name: string): string | null {
  if (!name.endsWith(DELETED_BRAND_SUFFIX)) return null;
  const slug = name.slice(0, -DELETED_BRAND_SUFFIX.length);
  if (slug.length === 0 || slug.startsWith(".") || slug.startsWith("_")) {
    return null;
  }
  return normalizeClientBrandSlug(slug);
}

export function isValidBrandSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

function normalizeAccent(input: string): string {
  return input.trim().toLowerCase();
}

function normalizeAgentSlug(input: string): string {
  return slugifyTitle(input);
}

function parseBrandJson(raw: string, fallbackSlug: string): ClientBrand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid brand file "${fallbackSlug}": JSON is malformed`);
  }

  const result = brandFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid brand file "${fallbackSlug}": ${result.error.issues[0]?.message ?? "validation failed"}`,
    );
  }

  return normalizeBrandInput(result.data, fallbackSlug);
}

function normalizeBrandInput(input: BrandFileInput, fallbackSlug?: string) {
  const slug = normalizeClientBrandSlug(input.slug || fallbackSlug || "");
  const accent = normalizeAccent(input.accent);
  if (!isValidBrandSlug(slug)) {
    throw new Error(
      "Brand slug must use lowercase letters, digits, or dashes and start with a letter or digit.",
    );
  }
  if (!HEX_COLOR_RE.test(accent)) {
    throw new Error("Brand accent must be a 6-digit hex color.");
  }

  return {
    slug,
    name: input.name.trim(),
    accent,
    locale: normalizeClientBrandLocale(input.locale),
    ...(input.welcomeText?.trim()
      ? { welcomeText: input.welcomeText.trim() }
      : {}),
    ...(input.modelId?.trim() ? { modelId: input.modelId.trim() } : {}),
    ...(input.agentSlug?.trim()
      ? { agentSlug: normalizeAgentSlug(input.agentSlug) }
      : {}),
  } satisfies ClientBrand;
}

function brandFilePath(slug: string): string {
  return `${BRANDS_DIR}/${slug}.json`;
}

function deletedBrandPath(slug: string): string {
  return `${BRANDS_DIR}/${slug}${DELETED_BRAND_SUFFIX}`;
}

export async function listDeletedBrandSlugs(): Promise<Set<string>> {
  const octokit = getOctokit();
  const cacheKey = `brands-deleted:${getOwner()}:${getRepo()}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached !== undefined) return new Set(cached);

  const { entries, etag } = await listStateDirectory(
    octokit,
    getOwner(),
    getRepo(),
    BRANDS_DIR,
  );
  const slugs = entries
    .filter((entry) => entry.type === "file")
    .map((entry) => slugFromDeletedName(entry.name))
    .filter((slug): slug is string => Boolean(slug));
  const unique = [...new Set(slugs)].sort();
  cacheSet(cacheKey, unique, etag);
  return new Set(unique);
}

export async function isBrandDeleted(slug: string): Promise<boolean> {
  const normalized = normalizeClientBrandSlug(slug);
  if (!isValidBrandSlug(normalized)) return false;
  const deleted = await listDeletedBrandSlugs();
  return deleted.has(normalized);
}

export async function listBrandFiles(): Promise<BrandFile[]> {
  const octokit = getOctokit();
  const cacheKey = `brands:${getOwner()}:${getRepo()}`;
  const cached = cacheGet<BrandFile[]>(cacheKey);
  if (cached !== undefined) return cached;

  const stale = cacheEntry<BrandFile[]>(cacheKey);
  try {
    const { entries, etag } = await listStateDirectory(
      octokit,
      getOwner(),
      getRepo(),
      BRANDS_DIR,
      stale?.etag ? { headers: { "If-None-Match": stale.etag } } : {},
    );
    const slugs = entries
      .filter((entry) => entry.type === "file")
      .map((entry) => slugFromName(entry.name))
      .filter((slug): slug is string => Boolean(slug));
    const files = await Promise.all(slugs.map((slug) => readBrandFile(slug)));
    const deletedSlugs = await listDeletedBrandSlugs();
    const brands = files
      .filter((file): file is BrandFile => file !== null)
      .filter((file) => !deletedSlugs.has(file.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    cacheSet(cacheKey, brands, etag);
    return brands;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 304 && stale) {
      cacheSet(cacheKey, stale.data, stale.etag);
      return stale.data;
    }
    throw error;
  }
}

export async function readBrandFile(
  slug: string,
  octokitOverride?: Octokit,
): Promise<BrandFile | null> {
  const normalized = normalizeClientBrandSlug(slug);
  if (!isValidBrandSlug(normalized)) return null;
  const cacheKey = `brand:${getOwner()}:${getRepo()}:${normalized}`;
  const cached = cacheGet<BrandFile | null>(cacheKey);
  if (cached !== undefined) return cached;

  const octokit = octokitOverride ?? getOctokit();
  const stale = cacheEntry<BrandFile | null>(cacheKey);
  const filePath = brandFilePath(normalized);
  try {
    const file = await readStateText(
      octokit,
      getOwner(),
      getRepo(),
      filePath,
      stale?.etag ? { headers: { "If-None-Match": stale.etag } } : {},
    );
    if (!file) {
      cacheSet(cacheKey, null);
      return null;
    }
    const brand = parseBrandJson(file.content, normalized);
    const resolved = {
      ...brand,
      source: "repo" as const,
      sha: file.sha,
      updatedAt: "",
      htmlUrl: file.htmlUrl ?? "",
    };
    cacheSet(cacheKey, resolved, file.etag);
    return resolved;
  } catch (error: unknown) {
    if ((error as { status?: number })?.status === 404) {
      cacheSet(cacheKey, null);
      return null;
    }
    if ((error as { status?: number })?.status === 304 && stale) {
      cacheSet(cacheKey, stale.data, stale.etag);
      return stale.data;
    }
    throw error;
  }
}

export async function findBrandFileFromList(
  slug: string,
): Promise<BrandFile | null> {
  const normalized = normalizeClientBrandSlug(slug);
  if (!isValidBrandSlug(normalized)) return null;
  const brands = await listBrandFiles();
  return brands.find((brand) => brand.slug === normalized) ?? null;
}

export interface WriteBrandOptions {
  octokit: Octokit;
  slug: string;
  name: string;
  accent: string;
  locale?: string;
  welcomeText?: string;
  modelId?: string;
  agentSlug?: string;
  sha?: string;
  message?: string;
}

function buildFileContent(opts: Omit<WriteBrandOptions, "octokit" | "sha">) {
  const brand = normalizeBrandInput({
    slug: opts.slug,
    name: opts.name,
    accent: opts.accent,
    locale: opts.locale,
    welcomeText: opts.welcomeText,
    modelId: opts.modelId,
    agentSlug: opts.agentSlug,
  });
  return `${JSON.stringify(brand, null, 2)}\n`;
}

async function deleteDisabledBrandMarker(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  const normalized = normalizeClientBrandSlug(slug);
  const path = deletedBrandPath(normalized);
  try {
    const existing = await readStateText(octokit, getOwner(), getRepo(), path);
    if (!existing) return;
    await deleteStateFile({
      octokit,
      owner: getOwner(),
      repo: getRepo(),
      path,
      message: `chore(brands): re-enable ${normalized}`,
      sha: existing.sha,
    });
  } catch (error: unknown) {
    if ((error as { status?: number })?.status !== 404) throw error;
  }
}

export async function writeBrandFile(
  opts: WriteBrandOptions,
): Promise<BrandFile> {
  const brand = normalizeBrandInput({
    slug: opts.slug,
    name: opts.name,
    accent: opts.accent,
    locale: opts.locale,
    welcomeText: opts.welcomeText,
    modelId: opts.modelId,
    agentSlug: opts.agentSlug,
  });
  const filePath = brandFilePath(brand.slug);
  await writeStateText({
    octokit: opts.octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: filePath,
    message:
      opts.message ??
      `${opts.sha ? "chore" : "feat"}(brands): ${opts.sha ? "update" : "add"} ${brand.slug}`,
    content: buildFileContent(opts),
    sha: opts.sha,
  });

  await deleteDisabledBrandMarker(opts.octokit, brand.slug);
  invalidateLocalBrandCache(brand.slug);
  invalidateBrandsCache(brand.slug);
  const refreshed = await readBrandFile(brand.slug, opts.octokit);
  if (!refreshed) {
    throw new Error(
      "writeBrandFile: file was written but could not be re-read",
    );
  }
  return refreshed;
}

export async function deleteBrandFile(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  const existing = await readBrandFile(slug, octokit);
  if (!existing) return;
  await deleteStateFile({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path: brandFilePath(existing.slug),
    message: `chore(brands): remove ${existing.slug}`,
    sha: existing.sha,
  });
  invalidateLocalBrandCache(existing.slug);
  invalidateBrandsCache(existing.slug);
}

export async function disableBrand(
  octokit: Octokit,
  slug: string,
): Promise<void> {
  const normalized = normalizeClientBrandSlug(slug);
  if (!isValidBrandSlug(normalized)) return;
  const path = deletedBrandPath(normalized);
  const existing = await readStateText(octokit, getOwner(), getRepo(), path);
  await writeStateText({
    octokit,
    owner: getOwner(),
    repo: getRepo(),
    path,
    message: existing
      ? `chore(brands): keep ${normalized} disabled`
      : `chore(brands): disable ${normalized}`,
    content: `${normalized}\n`,
    sha: existing?.sha,
  });
  invalidateLocalBrandCache(normalized);
  invalidateBrandsCache(normalized);
}
