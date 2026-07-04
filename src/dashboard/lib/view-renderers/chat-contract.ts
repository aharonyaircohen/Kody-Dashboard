/**
 * @fileType util
 * @domain view-renderers
 * @pattern chat-output-contract
 * @ai-summary Model-facing contract for rendering user-managed views from chat.
 */
import type { ViewRendererDefinition } from "./renderers";

export type ShowViewInput = {
  purpose: string;
  data?: Record<string, unknown>;
} & Record<string, unknown>;

export interface FallbackShowViewInput {
  purpose: string;
  data: Record<string, unknown>;
}

export interface RepairableShowViewToolCall {
  toolName: string;
  input: string;
}

type JsonSchemaRecord = Record<string, unknown>;

const SHOW_VIEW_RESERVED_INPUT_KEYS = new Set(["purpose", "data"]);

const RENDERER_MATCH_STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "as",
  "data",
  "for",
  "from",
  "in",
  "is",
  "it",
  "kody",
  "me",
  "of",
  "or",
  "purpose",
  "the",
  "this",
  "to",
  "use",
  "user",
  "when",
  "with",
]);

export function collectShowViewData(
  input: { data?: Record<string, unknown> } & Record<string, unknown>,
): Record<string, unknown> {
  const flatData = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) =>
        !SHOW_VIEW_RESERVED_INPUT_KEYS.has(key) && value !== undefined,
    ),
  );
  return {
    ...flatData,
    ...(input.data ?? {}),
  };
}

function rendererDataKeySet(definition: ViewRendererDefinition): Set<string> {
  return new Set(Object.keys(definition.data ?? {}));
}

function isListRendererField(
  definition: ViewRendererDefinition,
  bind: string,
): boolean {
  const type = definition.data?.[bind]?.type ?? "value";
  return type === "actions" || type === "selection";
}

function scalarRendererFieldJsonSchema(
  description: string | undefined,
): JsonSchemaRecord {
  return {
    type: "string",
    minLength: 1,
    ...(description ? { description } : {}),
  };
}

function listRendererFieldJsonSchema(
  description: string | undefined,
): JsonSchemaRecord {
  return {
    type: "array",
    minItems: 1,
    items: {
      anyOf: [
        { type: "string", minLength: 1 },
        {
          type: "object",
          minProperties: 1,
          additionalProperties: true,
        },
        {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1, maxLength: 64 },
            label: { type: "string", minLength: 1, maxLength: 60 },
            response: { type: "string", minLength: 1, maxLength: 500 },
            variant: {
              type: "string",
              enum: ["primary", "secondary", "danger"],
            },
          },
          required: ["id", "label", "response"],
          additionalProperties: false,
        },
      ],
    },
    ...(description ? { description } : {}),
  };
}

function rendererFieldJsonSchema(
  definition: ViewRendererDefinition,
  bind: string,
): JsonSchemaRecord {
  const field = definition.data?.[bind];
  const type = field?.type ?? "value";
  if (type === "actions" || type === "selection") {
    return listRendererFieldJsonSchema(field?.description);
  }
  return scalarRendererFieldJsonSchema(field?.description);
}

function rendererPurposeValues(definition: ViewRendererDefinition): string[] {
  return [
    definition.purpose,
    definition.slug,
    ...(definition.aliases ?? []),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function requiredRendererBinds(definition: ViewRendererDefinition): string[] {
  const defaults = definition.defaults ?? {};
  return [...rendererDataKeySet(definition)].filter((bind) => {
    if (definition.data?.[bind]?.optional) return false;
    return !Object.prototype.hasOwnProperty.call(defaults, bind);
  });
}

export function buildShowViewInputJsonSchema(
  definitions: ViewRendererDefinition[],
): JsonSchemaRecord {
  const fallbackDataSchema = {
    type: "object",
    minProperties: 1,
    additionalProperties: true,
    description:
      "Non-empty current values to render, keyed by the selected renderer rule's Data keys.",
  };
  const fallbackSchema = {
    type: "object",
    properties: {
      purpose: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        description:
          "The semantic view purpose from the available renderer rules. This is not a renderer slug.",
      },
      data: fallbackDataSchema,
    },
    required: ["purpose", "data"],
    additionalProperties: true,
  };

  if (definitions.length === 0) return fallbackSchema;

  return {
    type: "object",
    description:
      "Render data using one of the available user-managed renderer purposes.",
    oneOf: definitions.flatMap((definition) =>
      rendererPurposeValues(definition).map((purpose) => {
        const properties = Object.fromEntries(
          [...rendererDataKeySet(definition)].map((bind) => [
            bind,
            rendererFieldJsonSchema(definition, bind),
          ]),
        );
        const required = requiredRendererBinds(definition);
        return {
          type: "object",
          properties: {
            purpose: {
              type: "string",
              enum: [purpose],
              description:
                "The semantic view purpose from the available renderer rules.",
            },
            data: {
              type: "object",
              properties,
              required,
              minProperties: 1,
              additionalProperties: false,
              description:
                "Current values to render, using this renderer's Data keys.",
            },
          },
          required: ["purpose", "data"],
          additionalProperties: true,
        };
      }),
    ),
  };
}

export function validateShowViewInput(
  value: unknown,
): { success: true; value: ShowViewInput } | { success: false; error: Error } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      error: new Error("show_view input must be an object"),
    };
  }
  const input = value as Record<string, unknown>;
  if (typeof input.purpose !== "string" || !input.purpose.trim()) {
    return {
      success: false,
      error: new Error("show_view purpose is required"),
    };
  }
  if (
    input.data !== undefined &&
    (!input.data || typeof input.data !== "object" || Array.isArray(input.data))
  ) {
    return {
      success: false,
      error: new Error("show_view data must be an object"),
    };
  }
  const data = collectShowViewData(input);
  if (Object.keys(data).length === 0) {
    return {
      success: false,
      error: new Error("show_view requires data"),
    };
  }
  return {
    success: true,
    value: {
      ...(input as ShowViewInput),
      purpose: input.purpose.trim(),
      data,
    },
  };
}

function rendererTextTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 2 || RENDERER_MATCH_STOP_WORDS.has(raw)) continue;
    tokens.add(raw);
    if (raw.endsWith("ing") && raw.length > 5) tokens.add(raw.slice(0, -3));
    if (raw.endsWith("ed") && raw.length > 4) tokens.add(raw.slice(0, -2));
    if (raw.endsWith("s") && raw.length > 3) tokens.add(raw.slice(0, -1));
  }
  return tokens;
}

function rendererDefinitionText(definition: ViewRendererDefinition): string {
  return [
    definition.slug,
    definition.name,
    definition.purpose,
    ...(definition.aliases ?? []),
    definition.rule,
    ...Object.entries(definition.data ?? {}).flatMap(([key, field]) => [
      key,
      field.type,
      field.description,
    ]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function rendererMatchScore(
  definition: ViewRendererDefinition,
  userText: string,
): number {
  const userTokens = rendererTextTokens(userText);
  const definitionTokens = rendererTextTokens(
    rendererDefinitionText(definition),
  );
  let score = 0;
  for (const token of userTokens) {
    if (definitionTokens.has(token)) score += 1;
  }
  return score;
}

function firstUsefulLine(text: string): string {
  const line =
    text
      .split(/\r?\n/)
      .map((part) => part.replace(/^[-*]\s*/, "").trim())
      .find(Boolean) ?? "Confirm this request";
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

function listItemsFromUserText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^[-*]\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface CandidateList {
  items: unknown[];
  depth: number;
}

const SELECTABLE_RECORD_KEYS = new Set([
  "id",
  "label",
  "name",
  "response",
  "slug",
  "title",
  "value",
]);

const TOOL_WRAPPER_RECORD_KEYS = new Set([
  "content",
  "input",
  "output",
  "role",
  "toolCallId",
  "toolName",
  "toolResults",
  "type",
]);

function collectCandidateLists(value: unknown): CandidateList[] {
  const lists: CandidateList[] = [];
  const seen = new Set<unknown>();
  const visit = (candidate: unknown, depth: number) => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > 0) lists.push({ items: candidate, depth });
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (!isRecord(candidate)) return;
    for (const entry of Object.values(candidate)) visit(entry, depth + 1);
  };
  visit(value, 0);
  return lists;
}

function selectableRecordScore(item: Record<string, unknown>): number {
  const keys = Object.keys(item);
  const selectableKeys = keys.filter((key) => SELECTABLE_RECORD_KEYS.has(key));
  const wrapperKeys = keys.filter((key) => TOOL_WRAPPER_RECORD_KEYS.has(key));
  if (wrapperKeys.length > 0 && selectableKeys.length === 0) return -20;
  return selectableKeys.length * 4 + Math.min(keys.length, 4);
}

function selectableListScore(candidate: CandidateList): number {
  let score = candidate.depth;
  for (const item of candidate.items) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      score += 6;
      continue;
    }
    if (!isRecord(item)) return 0;
    const itemScore = selectableRecordScore(item);
    if (itemScore <= 0) return 0;
    score += itemScore;
  }
  return score;
}

function listItemsFromContext(
  context: readonly unknown[] | undefined,
): unknown[] {
  let best: CandidateList | null = null;
  let bestScore = 0;
  for (const candidate of collectCandidateLists(context ?? [])) {
    const score = selectableListScore(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.items ?? [];
}

function fallbackValueForRendererBind(
  definition: ViewRendererDefinition,
  bind: string,
  userText: string,
  context: readonly unknown[] | undefined,
): unknown | undefined {
  if (isListRendererField(definition, bind)) {
    const items = listItemsFromUserText(userText);
    if (items.length > 0) return items;
    const contextItems = listItemsFromContext(context);
    return contextItems.length > 0 ? contextItems : undefined;
  }
  return firstUsefulLine(userText);
}

export function buildFallbackShowViewInput({
  definitions,
  userText,
  context,
}: {
  definitions: ViewRendererDefinition[];
  userText: string | null | undefined;
  context?: readonly unknown[];
}): FallbackShowViewInput | null {
  const text = userText?.trim();
  if (!text || definitions.length === 0) return null;
  const ranked = definitions
    .map((definition, index) => ({
      definition,
      index,
      score: rendererMatchScore(definition, text),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) =>
      a.score === b.score ? a.index - b.index : b.score - a.score,
    );
  const definition = ranked[0]?.definition;
  if (!definition) return null;
  const data: Record<string, unknown> = {};
  const required = requiredRendererBinds(definition);
  const binds =
    required.length > 0 ? required : [...rendererDataKeySet(definition)];
  for (const bind of binds) {
    const value = fallbackValueForRendererBind(definition, bind, text, context);
    if (value === undefined) {
      if (required.includes(bind)) return null;
      continue;
    }
    data[bind] = value;
  }
  if (Object.keys(data).length === 0) return null;
  return {
    purpose: definition.purpose,
    data,
  };
}

export function repairShowViewToolCall<T extends RepairableShowViewToolCall>({
  toolCall,
  definitions,
  userText,
  context,
}: {
  toolCall: T;
  definitions: ViewRendererDefinition[];
  userText: string | null | undefined;
  context?: readonly unknown[];
}): T | null {
  const fallback = buildFallbackShowViewInput({
    definitions,
    userText,
    context,
  });
  if (!fallback) return null;
  return {
    ...toolCall,
    input: JSON.stringify(fallback),
  };
}
