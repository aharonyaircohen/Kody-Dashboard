import "server-only";

import type { Octokit } from "@octokit/rest";

import {
  buildCompanyStoreBlobUrl,
  listCompanyStoreDirectorySafe,
} from "../company-store/assets";

export interface CmsAdapterCatalogItem {
  name: string;
  label: string;
  description: string;
  supportsSchemaGeneration: boolean;
  htmlUrl: string | null;
}

const CMS_ADAPTER_ROOT = "cms/adapters";
const DEFAULT_CMS_ADAPTER = "storage";

const ADAPTER_METADATA: Record<
  string,
  Pick<
    CmsAdapterCatalogItem,
    "label" | "description" | "supportsSchemaGeneration"
  >
> = {
  storage: {
    label: "Storage",
    description: "JSON documents through the configured storage adapter",
    supportsSchemaGeneration: false,
  },
  mongodb: {
    label: "MongoDB",
    description: "MongoDB collections",
    supportsSchemaGeneration: true,
  },
  github: {
    label: "GitHub JSON",
    description: "JSON documents in the state repo",
    supportsSchemaGeneration: false,
  },
  file: {
    label: "kody-state JSON",
    description: "JSON documents in kody-state",
    supportsSchemaGeneration: false,
  },
};

export async function listStoreCmsAdapters(
  octokit: Octokit,
): Promise<CmsAdapterCatalogItem[]> {
  const entries = await listCompanyStoreDirectorySafe(
    octokit,
    CMS_ADAPTER_ROOT,
  );
  const storeAdapters = entries
    .filter(
      (entry) => entry.type === "dir" && isValidCmsAdapterName(entry.name),
    )
    .map((entry) => cmsAdapterCatalogItem(entry.name));
  const items = uniqueByName([
    cmsAdapterCatalogItem(DEFAULT_CMS_ADAPTER),
    ...storeAdapters,
  ]);
  return items.sort((a, b) => {
    if (a.name === DEFAULT_CMS_ADAPTER) return -1;
    if (b.name === DEFAULT_CMS_ADAPTER) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function isValidCmsAdapterName(name: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name);
}

export function defaultCmsAdapterSettings(
  adapter: string,
): Record<string, unknown> {
  if (adapter === "mongodb") return { databaseUriSecret: "DATABASE_URL" };
  if (adapter === "file") return { rootDir: "cms/content" };
  return {};
}

function cmsAdapterCatalogItem(name: string): CmsAdapterCatalogItem {
  const metadata = ADAPTER_METADATA[name] ?? {
    label: humanizeAdapterName(name),
    description: "Store CMS adapter",
    supportsSchemaGeneration: false,
  };

  return {
    name,
    ...metadata,
    htmlUrl:
      name === DEFAULT_CMS_ADAPTER
        ? null
        : buildCompanyStoreBlobUrl(`${CMS_ADAPTER_ROOT}/${name}/index.mjs`),
  };
}

function uniqueByName(items: CmsAdapterCatalogItem[]): CmsAdapterCatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

function humanizeAdapterName(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
