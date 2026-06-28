import type {
  CmsCollectionConfig,
  CmsFieldConfig,
  CmsPublicConfig,
} from "./types";
import { canWriteOperation } from "./permissions";

export interface CmsMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type CmsMcpToolAction = "list" | "get" | "create" | "update" | "delete";

export interface CmsMcpToolRef {
  action: CmsMcpToolAction;
  collection: string;
}

const BASE_TOOLS: CmsMcpTool[] = [
  {
    name: "cms_list_collections",
    description: "List configured CMS collections.",
    inputSchema: objectSchema({}),
  },
];

export function generateCmsMcpTools(config: CmsPublicConfig): CmsMcpTool[] {
  const tools = [...BASE_TOOLS];
  for (const collection of config.collections) {
    const slug = collection.mcpName || toMcpName(collection.name);
    if (collection.operations.list) {
      tools.push({
        name: `cms_list_${slug}`,
        description: `List ${collection.label} CMS documents. Each returned document includes cmsDocumentId; use that exact value for get, update, or delete.`,
        inputSchema: objectSchema({
          q: { type: "string", description: "Optional search query." },
          filters: {
            type: "object",
            description: "Optional CMS filter object keyed by field.",
            additionalProperties: true,
          },
          sort: {
            type: "array",
            description: "Optional sort entries.",
            items: objectSchema({
              field: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            }),
          },
          limit: { type: "number", minimum: 1, maximum: 100 },
          offset: { type: "number", minimum: 0 },
        }),
      });
    }
    if (collection.operations.get) {
      tools.push({
        name: `cms_get_${slug}`,
        description: `Get one ${collection.label} CMS document by id.`,
        inputSchema: objectSchema(
          {
            id: {
              type: "string",
              description: "Document id. Use the cmsDocumentId from list.",
            },
          },
          ["id"],
        ),
      });
    }
    if (isMcpActionAvailable(config, collection, "create")) {
      tools.push({
        name: `cms_create_${slug}`,
        description: `Create one ${collection.label} CMS document.`,
        inputSchema: objectSchema(
          { data: documentSchema(collection, { requireId: false }) },
          ["data"],
        ),
      });
    }
    if (isMcpActionAvailable(config, collection, "update")) {
      tools.push({
        name: `cms_update_${slug}`,
        description: `Update one ${collection.label} CMS document by id.`,
        inputSchema: objectSchema(
          {
            id: {
              type: "string",
              description: "Document id. Use the cmsDocumentId from list.",
            },
            data: documentSchema(collection, { requireId: false }),
          },
          ["id", "data"],
        ),
      });
    }
    if (isMcpActionAvailable(config, collection, "delete")) {
      tools.push({
        name: `cms_delete_${slug}`,
        description: `Delete one ${collection.label} CMS document by id.`,
        inputSchema: objectSchema(
          {
            id: {
              type: "string",
              description: "Document id. Use the cmsDocumentId from list.",
            },
          },
          ["id"],
        ),
      });
    }
  }
  return tools;
}

export function resolveCmsMcpTool(
  config: CmsPublicConfig,
  toolName: string,
): CmsMcpToolRef | null {
  if (toolName === "cms_list_collections") {
    return { action: "list", collection: "" };
  }
  for (const collection of config.collections) {
    const slug = collection.mcpName || toMcpName(collection.name);
    for (const action of [
      "list",
      "get",
      "create",
      "update",
      "delete",
    ] as const) {
      if (toolName === `cms_${action}_${slug}`) {
        if (!isMcpActionAvailable(config, collection, action)) return null;
        return { action, collection: collection.name };
      }
    }
  }
  return null;
}

function isMcpActionAvailable(
  config: CmsPublicConfig,
  collection: CmsCollectionConfig,
  action: CmsMcpToolAction,
): boolean {
  if (action === "list" || action === "get") {
    return collection.operations[action];
  }
  return canWriteOperation(
    collection,
    action,
    config.actorRole ?? "admin",
    config.permissions,
  );
}

function documentSchema(
  collection: CmsCollectionConfig,
  options: { requireId: boolean },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const field of collection.fields) {
    if (field.hidden || field.readOnly || field.type === "id") continue;
    properties[field.name] = fieldSchema(field);
    if (field.required) required.push(field.name);
  }
  return objectSchema(properties, options.requireId ? required : required);
}

function fieldSchema(field: CmsFieldConfig): Record<string, unknown> {
  const description = field.label ? `${field.label} field.` : undefined;
  if (field.options?.length) {
    const values = field.options.map((option) =>
      typeof option === "string" ? option : option.value,
    );
    if (field.type === "multiSelect") {
      return {
        type: "array",
        items: { type: "string", enum: values },
        ...(description ? { description } : {}),
      };
    }
    return {
      type: "string",
      enum: values,
      ...(description ? { description } : {}),
    };
  }
  switch (field.type) {
    case "number":
      return { type: "number", ...(description ? { description } : {}) };
    case "boolean":
      return { type: "boolean", ...(description ? { description } : {}) };
    case "date":
      return {
        type: "string",
        format: "date-time",
        ...(description ? { description } : {}),
      };
    case "relationMany":
      return {
        type: "array",
        items: { type: "string" },
        ...(description ? { description } : {}),
      };
    case "array":
      return { type: "array", ...(description ? { description } : {}) };
    case "object":
    case "json":
      return {
        type: "object",
        additionalProperties: true,
        ...(description ? { description } : {}),
      };
    default:
      return { type: "string", ...(description ? { description } : {}) };
  }
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function toMcpName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}
