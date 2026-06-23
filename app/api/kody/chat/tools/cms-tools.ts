import { tool, type ToolSet } from "ai";
import type { NextRequest } from "next/server";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import {
  createCmsDocument,
  deleteCmsDocument,
  getCmsDocument,
  listCmsCollections,
  listCmsDocuments,
  updateCmsDocument,
} from "@dashboard/lib/cms/service";
import type {
  CmsCollectionConfig,
  CmsConfigState,
  CmsDocument,
  CmsListQuery,
  CmsSortEntry,
} from "@dashboard/lib/cms/types";

interface Ctx {
  req: NextRequest;
  octokit: Octokit;
  owner: string;
  repo: string;
}

type ConfiguredCms = Extract<CmsConfigState, { configured: true }>;

const collectionInput = z.object({
  collection: z.string().trim().min(1).describe("CMS collection name."),
});

const listDocumentsInput = collectionInput.extend({
  q: z.string().trim().min(1).optional().describe("Optional search query."),
  filters: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional CMS filter object keyed by field."),
  sort: z
    .array(
      z.object({
        field: z.string().trim().min(1),
        direction: z.enum(["asc", "desc"]).default("desc"),
      }),
    )
    .optional()
    .describe("Optional sort entries."),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional(),
});

const documentInput = collectionInput.extend({
  id: z.string().trim().min(1).describe("Document id."),
});

const mutateDocumentInput = collectionInput.extend({
  operation: z.enum(["create", "update", "delete"]),
  id: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Required for update and delete."),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Required for create and update."),
});

export async function createCmsTools({
  req,
  octokit,
  owner,
  repo,
}: Ctx): Promise<ToolSet> {
  const actorRole = await getCmsActorRole(req, octokit, owner, repo);
  const cms = await listCmsCollections(octokit, owner, repo, actorRole);
  if (cms.configured === false) return {};

  return {
    cms_list_collections: tool({
      description:
        "List configured CMS collections and their supported operations.",
      inputSchema: z.object({}),
      execute: async () => ({
        collections: cms.collections.map(toCollectionSummary),
      }),
    }),

    cms_describe_collection: tool({
      description:
        "Describe one CMS collection, including fields, filters, and operations.",
      inputSchema: collectionInput,
      execute: async (input) => {
        const collection = findCollection(cms, input.collection);
        return { collection };
      },
    }),

    cms_list_documents: tool({
      description:
        "List or search CMS documents from any configured collection.",
      inputSchema: listDocumentsInput,
      execute: async (input) =>
        listCmsDocuments(req, octokit, owner, repo, input.collection, {
          search: input.q ? { query: input.q } : undefined,
          filters: input.filters as CmsListQuery["filters"],
          sort: input.sort as CmsSortEntry[] | undefined,
          limit: input.limit,
          offset: input.offset,
        }),
    }),

    cms_get_document: tool({
      description: "Get one CMS document by collection and id.",
      inputSchema: documentInput,
      execute: async (input) => ({
        document: await getCmsDocument(
          req,
          octokit,
          owner,
          repo,
          input.collection,
          input.id,
        ),
      }),
    }),

    cms_mutate_document: tool({
      description:
        "Create, update, or delete one CMS document by collection using the configured CMS adapter.",
      inputSchema: mutateDocumentInput,
      execute: async (input) =>
        mutateCmsDocument({ req, octokit, owner, repo, input }),
    }),
  };
}

async function mutateCmsDocument({
  req,
  octokit,
  owner,
  repo,
  input,
}: Ctx & { input: z.infer<typeof mutateDocumentInput> }): Promise<unknown> {
  if (input.operation === "create") {
    return {
      document: await createCmsDocument(
        req,
        octokit,
        owner,
        repo,
        input.collection,
        documentValue(input.data),
      ),
    };
  }

  if (!input.id) throw new Error("id is required for update and delete");

  if (input.operation === "update") {
    return {
      document: await updateCmsDocument(
        req,
        octokit,
        owner,
        repo,
        input.collection,
        input.id,
        documentValue(input.data),
      ),
    };
  }

  return {
    deleted: await deleteCmsDocument(
      req,
      octokit,
      owner,
      repo,
      input.collection,
      input.id,
    ),
  };
}

function findCollection(
  cms: ConfiguredCms,
  collectionName: string,
): CmsCollectionConfig {
  const collection = cms.collections.find(
    (candidate) => candidate.name === collectionName,
  );
  if (!collection) throw new Error(`unknown CMS collection: ${collectionName}`);
  return collection;
}

function toCollectionSummary(collection: CmsCollectionConfig) {
  return {
    name: collection.name,
    label: collection.label,
    adapter: collection.adapter,
    titleField: collection.titleField,
    searchFields: collection.searchFields,
    operations: collection.operations,
    fields: collection.fields.map((field) => ({
      name: field.name,
      type: field.type,
      label: field.label,
      required: field.required,
      readOnly: field.readOnly,
      hidden: field.hidden,
      target: field.target,
    })),
  };
}

function documentValue(value: unknown): CmsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("data must be an object");
  }
  return value as CmsDocument;
}
