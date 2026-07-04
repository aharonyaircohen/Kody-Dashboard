import { tool, type ToolSet } from "ai";
import type { NextRequest } from "next/server";
import type { Octokit } from "@octokit/rest";
import { z } from "zod";

import { getCmsActorRole } from "@dashboard/lib/cms/roles";
import {
  canWriteOperation,
  type CmsWriteOperation,
} from "@dashboard/lib/cms/permissions";
import {
  annotateCmsListResult,
  normalizeCmsDocumentIdInput,
} from "@dashboard/lib/cms/document-ids";
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
  CmsFieldConfig,
  CmsListQuery,
  CmsSortEntry,
} from "@dashboard/lib/cms/types";
import { getCmsDocumentValidationIssues } from "@dashboard/lib/cms/validation";
import { STATE_BRANCH } from "@dashboard/lib/state-branch";
import { resolveStateRepo } from "@dashboard/lib/state-repo";

interface Ctx {
  req: NextRequest;
  octokit: Octokit;
  owner: string;
  repo: string;
}

type ConfiguredCms = Extract<CmsConfigState, { configured: true }>;
type MutateDocumentInput = {
  collection: string;
  operation: CmsWriteOperation;
  id?: string;
  data?: Record<string, unknown>;
};

const CMS_MUTATION_OPERATIONS = [
  "create",
  "update",
  "delete",
] as const satisfies readonly CmsWriteOperation[];

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
  id: z
    .string()
    .trim()
    .min(1)
    .describe("Document id. Use the cmsDocumentId from cms_list_documents."),
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
  const stateBranch = await resolveStateRepo(octokit, owner, repo)
    .then((target) => target.branch)
    .catch(() => STATE_BRANCH);
  const mutationOperations = getAvailableMutationOperations(cms);
  const mutationOperationsTuple = toMutationOperationsTuple(mutationOperations);

  const tools: ToolSet = {
    cms_list_collections: tool({
      description:
        "List configured CMS collections and their supported operations through the same Dashboard CMS service, Content Entries source, and configured collection adapter.",
      inputSchema: z.object({}),
      execute: async () => ({
        collections: cms.collections.map((collection) =>
          toCollectionSummary(collection, stateBranch),
        ),
      }),
    }),

    cms_describe_collection: tool({
      description:
        "Describe one CMS collection from the same Dashboard CMS service, Content Entries source, and configured collection adapter, including fields, filters, and operations.",
      inputSchema: collectionInput,
      execute: async (input) => {
        const collection = findCollection(cms, input.collection);
        return { collection };
      },
    }),

    cms_list_documents: tool({
      description:
        "List or search CMS documents through the same Dashboard CMS service, Content Entries source, and configured collection adapter. Each returned document includes cmsDocumentId; use that exact value for cms_get_document or mutations.",
      inputSchema: listDocumentsInput,
      execute: async (input) => {
        const collection = findCollection(cms, input.collection);
        const result = await listCmsDocuments(
          req,
          octokit,
          owner,
          repo,
          collection.name,
          {
            search: input.q ? { query: input.q } : undefined,
            filters: input.filters as CmsListQuery["filters"],
            sort: input.sort as CmsSortEntry[] | undefined,
            limit: input.limit,
            offset: input.offset,
          },
        );
        return annotateCmsListResult(collection, result);
      },
    }),

    cms_get_document: tool({
      description:
        "Get one CMS document by collection and id through the same Dashboard CMS service, Content Entries source, and configured collection adapter.",
      inputSchema: documentInput,
      execute: async (input) => ({
        document: await getCmsDocument(
          req,
          octokit,
          owner,
          repo,
          input.collection,
          normalizeCmsDocumentIdInput(input.id),
        ),
      }),
    }),
  };

  if (mutationOperationsTuple) {
    tools.cms_mutate_document = tool({
      description: describeMutationTool(mutationOperations),
      inputSchema: buildMutateDocumentInput(cms, mutationOperationsTuple),
      execute: async (input) =>
        mutateCmsDocument({
          req,
          octokit,
          owner,
          repo,
          input,
          allowedOperations: mutationOperations,
        }),
    });
  }

  return tools;
}

function buildMutateDocumentInput(
  cms: ConfiguredCms,
  operations: readonly [CmsWriteOperation, ...CmsWriteOperation[]],
) {
  return collectionInput
    .extend({
      operation: z.enum(operations),
      id: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Required for update and delete."),
      data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          `Required for create and update. Match the configured collection fields exactly. ${describeMutationDataSchema(
            cms,
            operations,
          )}`,
        ),
    })
    .superRefine((input, ctx) => {
      const collection = getCollectionForValidation(cms, input.collection);
      if (!collection) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["collection"],
          message: `unknown CMS collection: ${input.collection}`,
        });
        return;
      }

      if (
        !canWriteOperation(
          collection,
          input.operation,
          cms.actorRole ?? "admin",
          cms.permissions,
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["operation"],
          message: `${input.operation} is not allowed for ${collection.name}`,
        });
        return;
      }

      if (input.operation === "delete") {
        if (!input.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["id"],
            message: "id is required for delete",
          });
        }
        return;
      }

      if (!input.data || typeof input.data !== "object") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data"],
          message: "data is required for create and update",
        });
        return;
      }

      if (input.operation === "update" && !input.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["id"],
          message: "id is required for update",
        });
      }

      for (const issue of getCmsDocumentValidationIssues(
        collection,
        input.data,
        { partial: input.operation === "update" },
      )) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["data"],
          message: issue,
        });
      }
    });
}

function getAvailableMutationOperations(cms: ConfiguredCms) {
  return CMS_MUTATION_OPERATIONS.filter((operation) =>
    cms.collections.some((collection) =>
      canWriteOperation(
        collection,
        operation,
        cms.actorRole ?? "admin",
        cms.permissions,
      ),
    ),
  );
}

function toMutationOperationsTuple(
  operations: CmsWriteOperation[],
): [CmsWriteOperation, ...CmsWriteOperation[]] | null {
  if (operations.length === 0) return null;
  return [operations[0], ...operations.slice(1)];
}

function describeMutationTool(operations: CmsWriteOperation[]): string {
  const actions = operations.join(", ");
  return `${actions} one CMS document through the same Dashboard CMS service, Content Entries source, and configured collection adapter. For update/delete, use the cmsDocumentId from cms_list_documents.`;
}

async function mutateCmsDocument({
  req,
  octokit,
  owner,
  repo,
  input,
  allowedOperations,
}: Ctx & {
  input: MutateDocumentInput;
  allowedOperations: CmsWriteOperation[];
}): Promise<unknown> {
  if (!allowedOperations.includes(input.operation)) {
    throw new Error(`${input.operation} CMS mutation is not available`);
  }

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
  const id = normalizeCmsDocumentIdInput(input.id);

  if (input.operation === "update") {
    return {
      document: await updateCmsDocument(
        req,
        octokit,
        owner,
        repo,
        input.collection,
        id,
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
      id,
    ),
  };
}

function findCollection(
  cms: ConfiguredCms,
  collectionName: string,
): CmsCollectionConfig {
  const collection = cms.collections.find(
    (candidate) =>
      candidate.name === collectionName || candidate.mcpName === collectionName,
  );
  if (!collection) throw new Error(`unknown CMS collection: ${collectionName}`);
  return collection;
}

function toCollectionSummary(
  collection: CmsCollectionConfig,
  stateBranch: string,
) {
  return {
    name: collection.name,
    label: collection.label,
    adapter: collection.adapter,
    source: collection.source,
    storage: describeCollectionStorage(collection, stateBranch),
    titleField: collection.titleField,
    searchFields: collection.searchFields,
    writePolicy: collection.writePolicy,
    permissions: collection.permissions,
    operations: collection.operations,
    fields: collection.fields.map((field) => ({
      name: field.name,
      type: field.type,
      label: field.label,
      description: field.description,
      placeholder: field.placeholder,
      required: field.required,
      readOnly: field.readOnly,
      hidden: field.hidden,
      display: field.display,
      validation: field.validation,
      options: field.options,
      target: field.target,
    })),
  };
}

function getCollectionForValidation(
  cms: ConfiguredCms,
  collectionName: string,
): CmsCollectionConfig | null {
  return (
    cms.collections.find(
      (candidate) =>
        candidate.name === collectionName ||
        candidate.mcpName === collectionName,
    ) ?? null
  );
}

function describeMutationDataSchema(
  cms: ConfiguredCms,
  operations: readonly CmsWriteOperation[],
): string {
  const writableCollections = cms.collections.filter((collection) =>
    operations.some((operation) =>
      canWriteOperation(
        collection,
        operation,
        cms.actorRole ?? "admin",
        cms.permissions,
      ),
    ),
  );
  if (writableCollections.length === 0) return "";
  return writableCollections
    .map((collection) => {
      const fields = collection.fields
        .filter((field) => !field.hidden)
        .map(describeField)
        .join("; ");
      return `${collection.name}: ${fields || "no writable fields"}.`;
    })
    .join(" ");
}

function describeField(field: CmsFieldConfig): string {
  const flags = [
    field.required ? "required" : null,
    field.readOnly ? "read-only" : null,
  ].filter(Boolean);
  const optionValues = field.options?.map((option) =>
    typeof option === "string" ? option : option.value,
  );
  const options =
    optionValues && optionValues.length > 0
      ? `options: ${optionValues.join(", ")}`
      : null;
  const suffix = [...flags, options].filter(Boolean).join(", ");
  return `${field.name} (${field.type}${suffix ? `, ${suffix}` : ""})`;
}

function describeCollectionStorage(
  collection: CmsCollectionConfig,
  stateBranch: string,
) {
  const path =
    collection.source.path ?? collection.source.collection ?? collection.name;
  const idField = collection.source.idField ?? "_id";
  const extension = collection.source.extension ?? "json";

  if (collection.adapter === "github") {
    return {
      kind: "github-json",
      path,
      idField,
      extension,
      branch: stateBranch,
    };
  }

  if (collection.adapter === "file") {
    return {
      kind: "file-json",
      path,
      idField,
      extension,
    };
  }

  return {
    kind: "adapter",
    collection: path,
    idField,
  };
}

function documentValue(value: unknown): CmsDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("data must be an object");
  }
  return value as CmsDocument;
}
