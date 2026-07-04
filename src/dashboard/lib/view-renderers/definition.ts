/**
 * @fileType util
 * @domain view-renderers
 * @pattern renderer-definition-contract
 * @ai-summary Shared schema, validation, and one-way legacy migration for
 *   user-managed renderer JSON definitions.
 */
import { z } from "zod";
import type { RenderedViewAction } from "@dashboard/lib/chat-ui-actions";

export const VIEW_RENDERER_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RendererActionDefaultSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(60),
  response: z.string().trim().min(1).max(500),
  variant: z.enum(["primary", "secondary", "danger"]).optional(),
});

const RendererDefaultValueSchema = z.union([
  z.string().max(2_000),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(RendererActionDefaultSchema).max(20),
]);

const RendererDataFieldSchema = z.object({
  description: z.string().trim().min(1).max(300).optional(),
  type: z
    .enum(["text", "markdown", "actions", "selection", "input", "value"])
    .optional(),
  optional: z.boolean().optional(),
});

export type RendererUiTemplateNode =
  | {
      type: "stack" | "row" | "list";
      children?: RendererUiTemplateNode[];
      for?: string;
      as?: string;
      item?: RendererUiTemplateNode;
    }
  | {
      type: "text";
      value: string;
      variant?: "title" | "body" | "label";
    }
  | {
      type: "markdown";
      value: string;
    }
  | {
      type: "input";
      value: string;
      label?: string;
      readOnly?: boolean;
    }
  | {
      type: "button";
      label: string;
      action: string | RenderedViewAction;
    }
  | {
      type: "checkbox";
      name: string;
      value: string;
      label: string;
    }
  | {
      type: "submit";
      label: string;
    };

const RendererUiTemplateNodeSchema: z.ZodType<RendererUiTemplateNode> = z.lazy(
  () =>
    z.discriminatedUnion("type", [
      z.object({
        type: z.enum(["stack", "row", "list"]),
        children: z.array(RendererUiTemplateNodeSchema).max(50).optional(),
        for: z.string().trim().min(1).max(120).optional(),
        as: z.string().trim().min(1).max(40).optional(),
        item: RendererUiTemplateNodeSchema.optional(),
      }),
      z.object({
        type: z.literal("text"),
        value: z.string().max(2_000),
        variant: z.enum(["title", "body", "label"]).optional(),
      }),
      z.object({
        type: z.literal("markdown"),
        value: z.string().max(10_000),
      }),
      z.object({
        type: z.literal("input"),
        value: z.string().max(2_000),
        label: z.string().trim().min(1).max(80).optional(),
        readOnly: z.boolean().optional(),
      }),
      z.object({
        type: z.literal("button"),
        label: z.string().max(200),
        action: z.union([z.string().max(200), RendererActionDefaultSchema]),
      }),
      z.object({
        type: z.literal("checkbox"),
        name: z.string().trim().min(1).max(80),
        value: z.string().max(200),
        label: z.string().max(200),
      }),
      z.object({
        type: z.literal("submit"),
        label: z.string().trim().min(1).max(80),
      }),
    ]),
);

const ViewRendererDefinitionSchema = z
  .object({
    slug: z.string().regex(VIEW_RENDERER_SLUG_RE),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).optional(),
    purpose: z.string().regex(VIEW_RENDERER_SLUG_RE).optional(),
    aliases: z
      .array(z.string().regex(VIEW_RENDERER_SLUG_RE))
      .max(20)
      .optional(),
    rule: z.string().trim().min(1).max(1_000).optional(),
    data: z.record(z.string(), RendererDataFieldSchema).optional(),
    defaults: z.record(z.string(), RendererDefaultValueSchema).optional(),
    type: z.literal("layout"),
    ui: RendererUiTemplateNodeSchema,
  })
  .superRefine((definition, ctx) => {
    const dataKeys = new Set(Object.keys(definition.data ?? {}));
    const referencedKeys = rendererUiDataReferences(definition.ui);
    for (const key of referencedKeys) {
      if (dataKeys.has(key)) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ui"],
        message: `UI references "$${key}" but data key "${key}" is not declared`,
      });
    }
  })
  .transform((definition) => ({
    ...definition,
    purpose: definition.purpose ?? definition.slug,
  }));

const LegacyRendererBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("title"),
    bind: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("text"),
    bind: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("markdown"),
    bind: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("buttons"),
    bind: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("selection"),
    bind: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    type: z.literal("input"),
    bind: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80).optional(),
  }),
]);

const LegacyViewRendererDefinitionSchema = z.object({
  slug: z.string().regex(VIEW_RENDERER_SLUG_RE),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
  purpose: z.string().regex(VIEW_RENDERER_SLUG_RE).optional(),
  aliases: z.array(z.string().regex(VIEW_RENDERER_SLUG_RE)).max(20).optional(),
  rule: z.string().trim().min(1).max(1_000).optional(),
  data: z.record(z.string(), RendererDataFieldSchema).optional(),
  defaults: z.record(z.string(), RendererDefaultValueSchema).optional(),
  type: z.literal("layout"),
  blocks: z.array(LegacyRendererBlockSchema).min(1).max(20),
});

export type ViewRendererDefinition = z.infer<
  typeof ViewRendererDefinitionSchema
>;

type LegacyViewRendererDefinition = z.infer<
  typeof LegacyViewRendererDefinitionSchema
>;

export interface ParsedViewRendererDefinition {
  definition: ViewRendererDefinition;
  migrated: boolean;
}

function rendererUiDataReferences(
  node: RendererUiTemplateNode,
  locals = new Set<string>(),
): Set<string> {
  const refs = new Set<string>();
  collectRendererUiDataReferences(node, locals, refs);
  return refs;
}

function collectRendererUiDataReferences(
  node: RendererUiTemplateNode,
  locals: Set<string>,
  refs: Set<string>,
): void {
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    collectStringDataReferences(node.for, locals, refs);
    const childLocals = new Set(locals);
    if (node.for) {
      childLocals.add(node.as ?? "item");
      childLocals.add("index");
    }
    for (const child of node.children ?? []) {
      collectRendererUiDataReferences(child, locals, refs);
    }
    if (node.item) {
      collectRendererUiDataReferences(node.item, childLocals, refs);
    }
    return;
  }
  if (node.type === "text" || node.type === "markdown") {
    collectStringDataReferences(node.value, locals, refs);
    return;
  }
  if (node.type === "input") {
    collectStringDataReferences(node.value, locals, refs);
    collectStringDataReferences(node.label, locals, refs);
    return;
  }
  if (node.type === "button") {
    collectStringDataReferences(node.label, locals, refs);
    if (typeof node.action === "string") {
      collectStringDataReferences(node.action, locals, refs);
    }
    return;
  }
  if (node.type === "checkbox") {
    collectStringDataReferences(node.name, locals, refs);
    collectStringDataReferences(node.value, locals, refs);
    collectStringDataReferences(node.label, locals, refs);
    return;
  }
  if (node.type === "submit") {
    collectStringDataReferences(node.label, locals, refs);
  }
}

function collectStringDataReferences(
  value: string | undefined,
  locals: Set<string>,
  refs: Set<string>,
): void {
  if (!value) return;
  for (const match of value.matchAll(/\$([a-zA-Z0-9_.-]+)/g)) {
    const path = match[1].split(".").filter(Boolean);
    const root = path[0];
    if (!root || locals.has(root)) continue;
    if (root === "data") {
      const key = path[1];
      if (key) refs.add(key);
      continue;
    }
    refs.add(root);
  }
}

function dataTypeForLegacyBlock(
  block: z.infer<typeof LegacyRendererBlockSchema>,
): NonNullable<z.infer<typeof RendererDataFieldSchema>["type"]> {
  if (block.type === "buttons") return "actions";
  if (block.type === "selection") return "selection";
  if (block.type === "markdown") return "markdown";
  if (block.type === "input") return "input";
  return "text";
}

function uiNodeForLegacyBlock(
  block: z.infer<typeof LegacyRendererBlockSchema>,
): RendererUiTemplateNode {
  if (block.type === "title") {
    return { type: "text", variant: "title", value: `$${block.bind}` };
  }
  if (block.type === "text") {
    return { type: "text", value: `$${block.bind}` };
  }
  if (block.type === "markdown") {
    return { type: "markdown", value: `$${block.bind}` };
  }
  if (block.type === "input") {
    return {
      type: "input",
      value: `$${block.bind}`,
      ...(block.label ? { label: block.label } : {}),
    };
  }
  if (block.type === "buttons") {
    return {
      type: "row",
      for: `$${block.bind}`,
      as: "action",
      item: {
        type: "button",
        label: "$action.label",
        action: "$action",
      },
    };
  }
  return {
    type: "list",
    for: `$${block.bind}`,
    as: "item",
    item: {
      type: "button",
      label: "$item.label",
      action: "$item",
    },
  };
}

function migrateLegacyRendererDefinition(
  legacy: LegacyViewRendererDefinition,
): ViewRendererDefinition {
  const data = { ...(legacy.data ?? {}) };
  for (const block of legacy.blocks) {
    data[block.bind] = {
      type: data[block.bind]?.type ?? dataTypeForLegacyBlock(block),
      ...(data[block.bind]?.description
        ? { description: data[block.bind]?.description }
        : {}),
      ...(data[block.bind]?.optional
        ? { optional: data[block.bind]?.optional }
        : {}),
    };
  }
  const candidate = {
    slug: legacy.slug,
    name: legacy.name,
    ...(legacy.description ? { description: legacy.description } : {}),
    ...(legacy.purpose ? { purpose: legacy.purpose } : {}),
    ...(legacy.aliases ? { aliases: legacy.aliases } : {}),
    ...(legacy.rule ? { rule: legacy.rule } : {}),
    data,
    ...(legacy.defaults ? { defaults: legacy.defaults } : {}),
    type: "layout" as const,
    ui: {
      type: "stack" as const,
      children: legacy.blocks.map(uiNodeForLegacyBlock),
    },
  };
  return ViewRendererDefinitionSchema.parse(candidate);
}

export function parseViewRendererDefinitionInput(
  raw: string,
): ParsedViewRendererDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid view renderer: expected JSON");
  }
  const current = ViewRendererDefinitionSchema.safeParse(parsed);
  if (current.success) {
    return { definition: current.data, migrated: false };
  }
  const legacy = LegacyViewRendererDefinitionSchema.safeParse(parsed);
  if (legacy.success) {
    return {
      definition: migrateLegacyRendererDefinition(legacy.data),
      migrated: true,
    };
  }
  throw new Error(
    `Invalid view renderer: ${current.error.issues
      .map((issue) => issue.message)
      .join("; ")}`,
  );
}

export function parseViewRendererDefinition(
  raw: string,
): ViewRendererDefinition {
  return parseViewRendererDefinitionInput(raw).definition;
}

export function serializeViewRendererDefinition(
  definition: ViewRendererDefinition,
): string {
  const parsed = ViewRendererDefinitionSchema.parse(definition);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
