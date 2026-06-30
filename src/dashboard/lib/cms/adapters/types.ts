import type {
  CmsAdapterSettings,
  CmsCollectionConfig,
  CmsDocument,
  CmsListQuery,
  CmsListResult,
  CmsRuntimeConfig,
} from "../types";
import type { Octokit } from "@octokit/rest";

export class CmsAdapterError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "CmsAdapterError";
    this.code = code;
    this.status = status;
  }
}

export interface CmsAdapterContext {
  config: CmsRuntimeConfig;
  collection: CmsCollectionConfig;
  settings: CmsAdapterSettings;
  getSecret: (name: string) => Promise<string | null>;
  store?: {
    octokit: Octokit;
    repoUrl?: string;
    ref?: string;
  };
  getStateRepository?: () => Promise<{
    octokit: Octokit;
    owner: string;
    repo: string;
    branch: string;
    basePath: string;
  }>;
}

export interface CmsAdapter {
  name: string;
  list: (
    context: CmsAdapterContext,
    query: CmsListQuery,
  ) => Promise<CmsListResult>;
  listByIds: (
    context: CmsAdapterContext,
    ids: string[],
  ) => Promise<CmsDocument[]>;
  get: (context: CmsAdapterContext, id: string) => Promise<CmsDocument | null>;
  create: (
    context: CmsAdapterContext,
    data: CmsDocument,
  ) => Promise<CmsDocument>;
  update: (
    context: CmsAdapterContext,
    id: string,
    data: CmsDocument,
  ) => Promise<CmsDocument | null>;
  delete: (context: CmsAdapterContext, id: string) => Promise<boolean>;
}
