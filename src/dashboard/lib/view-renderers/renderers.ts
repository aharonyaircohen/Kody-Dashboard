/**
 * @fileType util
 * @domain view-renderers
 * @pattern state-repo-config
 * @ai-summary User-managed renderer definitions stored under
 *   `views/renderers/<slug>.json` in the Kody state repo.
 */
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  RENDER_VIEW_DIRECTIVE,
  getRenderedViewUi,
  type RenderedViewDataValue,
  type RenderedViewDirective,
} from "@dashboard/lib/chat-ui-actions";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  writeStateText,
} from "@dashboard/lib/state-repo";

export const VIEW_RENDERERS_DIR = "views/renderers";

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidViewRendererSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

const RendererBlockSchema = z.discriminatedUnion("type", [
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

const RendererActionDefaultSchema = z.object({
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

const ViewRendererDefinitionSchema = z
  .object({
    slug: z.string().regex(SLUG_RE),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(300).optional(),
    purpose: z.string().regex(SLUG_RE).optional(),
    aliases: z.array(z.string().regex(SLUG_RE)).max(20).optional(),
    rule: z.string().trim().min(1).max(1_000).optional(),
    data: z.record(z.string(), RendererDataFieldSchema).optional(),
    defaults: z.record(z.string(), RendererDefaultValueSchema).optional(),
    type: z.literal("layout"),
    blocks: z.array(RendererBlockSchema).min(1).max(20),
  })
  .transform((definition) => ({
    ...definition,
    purpose: definition.purpose ?? definition.slug,
  }));

export type ViewRendererDefinition = z.infer<
  typeof ViewRendererDefinitionSchema
>;

export interface ViewRendererDefinitionFile {
  definition: ViewRendererDefinition;
  source: "repo";
  sha: string;
  htmlUrl: string;
}

export interface ViewRendererPromptContext {
  rules: string | null;
  definitions: ViewRendererDefinition[];
}

function filePathForSlug(slug: string): string {
  return `${VIEW_RENDERERS_DIR}/${slug}.json`;
}

export function parseViewRendererDefinition(
  raw: string,
): ViewRendererDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid view renderer: expected JSON");
  }
  const result = ViewRendererDefinitionSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid view renderer: ${result.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return result.data;
}

export function serializeViewRendererDefinition(
  definition: ViewRendererDefinition,
): string {
  const parsed = ViewRendererDefinitionSchema.parse(definition);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function buildRenderedViewDirective({
  id,
  definition,
  data,
}: {
  id: string;
  definition: ViewRendererDefinition;
  data: Record<string, unknown>;
}): RenderedViewDirective {
  const normalizedData = normalizeViewRendererData(definition, data);
  const mergedData = mergeViewRendererDefaults(definition, normalizedData);
  const directive: RenderedViewDirective = {
    action: RENDER_VIEW_DIRECTIVE,
    view: "renderer",
    id,
    rendererSlug: definition.slug,
    rendererName: definition.name,
    resultTarget: "chat",
    blocks: definition.blocks.map((block) => ({ ...block })),
    data: mergedData,
  };
  return { ...directive, ui: getRenderedViewUi(directive) };
}

function cloneDefaultValue(
  value: RenderedViewDataValue,
): RenderedViewDataValue {
  if (Array.isArray(value)) {
    return value.map((action) => ({ ...action }));
  }
  return value;
}

export function mergeViewRendererDefaults(
  definition: ViewRendererDefinition,
  data: Record<string, RenderedViewDataValue>,
): Record<string, RenderedViewDataValue> {
  const defaults = definition.defaults ?? {};
  const merged = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      cloneDefaultValue(value as RenderedViewDataValue),
    ]),
  ) as Record<string, RenderedViewDataValue>;
  return { ...merged, ...data };
}

function rendererBindSet(definition: ViewRendererDefinition): Set<string> {
  return new Set(definition.blocks.map((block) => block.bind));
}

function blockTypeForBind(
  definition: ViewRendererDefinition,
  bind: string,
): string {
  const block = definition.blocks.find((candidate) => candidate.bind === bind);
  if (!block) return "value";
  if (block.type === "buttons") return "actions";
  return block.type;
}

function isRendererAction(
  value: unknown,
): value is z.infer<typeof RendererActionDefaultSchema> {
  const result = RendererActionDefaultSchema.safeParse(value);
  return result.success;
}

function actionIdFromLabel(label: string): string {
  const id = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || "action";
}

function normalizeRendererAction(
  value: string | z.infer<typeof RendererActionDefaultSchema>,
): z.infer<typeof RendererActionDefaultSchema> {
  if (typeof value !== "string") {
    return {
      id: value.id,
      label: value.label,
      response: value.response,
      ...(value.variant ? { variant: value.variant } : {}),
    };
  }
  const label = value.trim();
  const id = actionIdFromLabel(label);
  return { id, label, response: id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function primitiveRendererValue(
  value: unknown,
): RenderedViewDataValue | undefined {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function listItemsFromValue(
  value: unknown,
): Array<string | z.infer<typeof RendererActionDefaultSchema>> | null {
  if (Array.isArray(value)) {
    const items = value.filter(
      (item): item is string | z.infer<typeof RendererActionDefaultSchema> =>
        typeof item === "string" || isRendererAction(item),
    );
    return items.length === value.length ? items : null;
  }
  if (isRendererAction(value)) return [value];
  if (!isRecord(value)) return null;

  const keys = Object.keys(value);
  const numericKeys = keys.filter((key) => /^\d+$/.test(key));
  if (numericKeys.length === keys.length && numericKeys.length > 0) {
    return listItemsFromValue(
      numericKeys
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]),
    );
  }

  if (keys.length === 1) {
    return listItemsFromValue(value[keys[0]]);
  }

  return listItemsFromValue(Object.values(value));
}

function isListRendererField(
  definition: ViewRendererDefinition,
  bind: string,
): boolean {
  const type =
    definition.data?.[bind]?.type ?? blockTypeForBind(definition, bind);
  return type === "actions" || type === "selection";
}

function normalizeRendererFieldValue({
  definition,
  bind,
  value,
}: {
  definition: ViewRendererDefinition;
  bind: string;
  value: unknown;
}): RenderedViewDataValue {
  if (isListRendererField(definition, bind)) {
    const items = listItemsFromValue(value);
    if (!items) {
      throw new Error(
        `Invalid renderer data for "${bind}": expected a list of choices`,
      );
    }
    return items.map(normalizeRendererAction);
  }
  const primitive = primitiveRendererValue(value);
  if (primitive !== undefined) return primitive;
  throw new Error(
    `Invalid renderer data for "${bind}": expected a scalar value`,
  );
}

export function normalizeViewRendererData(
  definition: ViewRendererDefinition,
  data: Record<string, unknown>,
): Record<string, RenderedViewDataValue> {
  const normalized: Record<string, RenderedViewDataValue> = {};
  for (const bind of rendererBindSet(definition)) {
    if (!Object.prototype.hasOwnProperty.call(data, bind)) continue;
    const value = data[bind];
    if (value === undefined) continue;
    normalized[bind] = normalizeRendererFieldValue({
      definition,
      bind,
      value,
    });
  }
  return normalized;
}

function dataKeyLines(definition: ViewRendererDefinition): string[] {
  const defaults = definition.defaults ?? {};
  return [...rendererBindSet(definition)].map((bind) => {
    const field = definition.data?.[bind];
    const type = field?.type ?? blockTypeForBind(definition, bind);
    const markers = [
      type,
      Object.prototype.hasOwnProperty.call(defaults, bind)
        ? "default available"
        : null,
      field?.optional ? "optional" : null,
    ].filter(Boolean);
    const suffix = field?.description ? `: ${field.description}` : "";
    return `  - ${bind}${markers.length > 0 ? ` (${markers.join(", ")})` : ""}${suffix}`;
  });
}

export function buildViewRendererRulesPrompt(
  definitions: ViewRendererDefinition[],
): string | null {
  const lines = definitions
    .filter((definition) => definition.rule?.trim())
    .map((definition) => {
      const aliases =
        definition.aliases && definition.aliases.length > 0
          ? `\n  Aliases: ${definition.aliases.map((alias) => `\`${alias}\``).join(", ")}`
          : "";
      return `- Purpose \`${definition.purpose}\`: ${definition.rule?.trim()}${aliases}\n  Data keys:\n${dataKeyLines(definition).join("\n")}`;
    });
  return lines.length > 0 ? lines.join("\n") : null;
}

export function matchViewRendererDefinition(
  definitions: ViewRendererDefinition[],
  purpose: string,
  data: Record<string, unknown>,
): ViewRendererDefinition | null {
  const dataKeys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (dataKeys.length === 0) return null;
  const purposeMatches = definitions.filter(
    (definition) =>
      definition.purpose === purpose ||
      definition.slug === purpose ||
      definition.aliases?.includes(purpose),
  );
  if (purposeMatches.length === 0) return null;
  const matches = purposeMatches
    .map((definition, index) => {
      const binds = rendererBindSet(definition);
      const matched = dataKeys.filter((key) => binds.has(key)).length;
      const missing = [...binds].filter(
        (bind) => !dataKeys.includes(bind),
      ).length;
      return { definition, index, matched, missing, bindCount: binds.size };
    })
    .filter((candidate) => candidate.matched > 0)
    .sort((a, b) => {
      if (a.missing !== b.missing) return a.missing - b.missing;
      if (a.matched !== b.matched) return b.matched - a.matched;
      if (a.bindCount !== b.bindCount) return b.bindCount - a.bindCount;
      return a.index - b.index;
    });
  return matches[0]?.definition ?? null;
}

export async function readViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  slug,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile | null> {
  if (!isValidViewRendererSlug(slug)) return null;
  const file = await readStateText(octokit, owner, repo, filePathForSlug(slug));
  if (!file) return null;
  return {
    definition: parseViewRendererDefinition(file.content),
    source: "repo",
    sha: file.sha,
    htmlUrl: file.htmlUrl ?? "",
  };
}

export async function resolveViewRendererDefinition({
  octokit,
  owner,
  repo,
  slug,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  slug: string;
}): Promise<ViewRendererDefinitionFile> {
  const file = await readViewRendererDefinitionFile({
    octokit,
    owner,
    repo,
    slug,
  });
  if (file) return file;
  throw new Error(`View renderer "${slug}" not found`);
}

export async function resolveBestViewRendererDefinition({
  octokit,
  owner,
  repo,
  purpose,
  data,
}: {
  octokit?: Octokit;
  owner?: string;
  repo?: string;
  purpose: string;
  data: Record<string, unknown>;
}): Promise<ViewRendererDefinitionFile> {
  const files =
    octokit && owner && repo
      ? await listViewRendererDefinitionFiles({ octokit, owner, repo })
      : [];
  const definitions = files.map((file) => file.definition);
  const matched = matchViewRendererDefinition(definitions, purpose, data);
  if (!matched) {
    throw new Error(`No view renderer matches purpose "${purpose}"`);
  }
  const repoFile = files.find((file) => file.definition.slug === matched.slug);
  if (!repoFile) {
    throw new Error(`View renderer "${matched.slug}" not found`);
  }
  return repoFile;
}

export async function loadViewRendererRulesForPrompt({
  octokit,
  owner,
  repo,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<string | null> {
  return (await loadViewRendererContextForPrompt({ octokit, owner, repo }))
    .rules;
}

export async function loadViewRendererContextForPrompt({
  octokit,
  owner,
  repo,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<ViewRendererPromptContext> {
  const files = await listViewRendererDefinitionFiles({ octokit, owner, repo });
  const definitions = files
    .map((file) => file.definition)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    rules: buildViewRendererRulesPrompt(definitions),
    definitions,
  };
}

export async function listViewRendererDefinitionFiles({
  octokit,
  owner,
  repo,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): Promise<ViewRendererDefinitionFile[]> {
  const { entries } = await listStateDirectory(
    octokit,
    owner,
    repo,
    VIEW_RENDERERS_DIR,
  );
  const files = await Promise.all(
    entries
      .filter((entry) => entry.type === "file" && entry.name.endsWith(".json"))
      .map((entry) =>
        readViewRendererDefinitionFile({
          octokit,
          owner,
          repo,
          slug: entry.name.slice(0, -".json".length),
        }).catch(() => null),
      ),
  );
  return files.filter((file): file is ViewRendererDefinitionFile =>
    Boolean(file),
  );
}

export async function writeViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  definition,
  sha,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  definition: ViewRendererDefinition;
  sha?: string;
  message: string;
}): Promise<ViewRendererDefinitionFile> {
  const content = serializeViewRendererDefinition(definition);
  const written = await writeStateText({
    octokit,
    owner,
    repo,
    path: filePathForSlug(definition.slug),
    content,
    message,
    ...(sha ? { sha } : {}),
  });
  return {
    definition,
    source: "repo",
    sha: written.sha ?? "",
    htmlUrl: written.htmlUrl ?? "",
  };
}

export async function deleteViewRendererDefinitionFile({
  octokit,
  owner,
  repo,
  slug,
  sha,
  message,
}: {
  octokit: Octokit;
  owner: string;
  repo: string;
  slug: string;
  sha: string;
  message: string;
}): Promise<void> {
  await deleteStateFile({
    octokit,
    owner,
    repo,
    path: filePathForSlug(slug),
    sha,
    message,
  });
}
