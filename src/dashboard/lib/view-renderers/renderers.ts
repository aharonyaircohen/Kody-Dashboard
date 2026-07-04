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
  type RenderedViewAction,
  type RenderedViewDataValue,
  type RenderedViewDirective,
  type RenderedViewUiNode,
} from "@dashboard/lib/chat-ui-actions";
import {
  deleteStateFile,
  listStateDirectory,
  readStateText,
  writeStateText,
} from "@dashboard/lib/state-repo";
import {
  RendererActionDefaultSchema,
  VIEW_RENDERER_SLUG_RE,
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  type RendererUiTemplateNode,
  type ViewRendererDefinition,
} from "./definition";

export const VIEW_RENDERERS_DIR = "views/renderers";

export function isValidViewRendererSlug(slug: string): boolean {
  return VIEW_RENDERER_SLUG_RE.test(slug);
}
export {
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  type ViewRendererDefinition,
};

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
  const ui = resolveRendererUiTemplate(definition.ui, { data: mergedData }) ?? {
    type: "stack" as const,
    children: [],
  };
  return {
    action: RENDER_VIEW_DIRECTIVE,
    view: "renderer",
    id,
    rendererSlug: definition.slug,
    rendererName: definition.name,
    resultTarget: "chat",
    ui,
    data: mergedData,
  };
}

type RendererUiScope = {
  data: Record<string, RenderedViewDataValue>;
  locals?: Record<string, unknown>;
};

function scopeValue(scope: RendererUiScope, root: string): unknown {
  if (root === "data") return scope.data;
  if (Object.prototype.hasOwnProperty.call(scope.data, root)) {
    return scope.data[root];
  }
  return scope.locals?.[root];
}

function resolvePath(scope: RendererUiScope, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  let value = scopeValue(scope, parts[0]);
  for (const part of parts.slice(1)) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) {
      value = value[Number(part)];
      continue;
    }
    if (typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function resolveTemplateValue(value: string, scope: RendererUiScope): unknown {
  const exact = /^\$([a-zA-Z0-9_.-]+)$/.exec(value);
  if (exact) return resolvePath(scope, exact[1]);
  return value.replace(/\$([a-zA-Z0-9_.-]+)/g, (_match, path: string) => {
    const resolved = resolvePath(scope, path);
    return resolved === null || resolved === undefined ? "" : String(resolved);
  });
}

function resolveTemplateString(value: string, scope: RendererUiScope): string {
  const resolved = resolveTemplateValue(value, scope);
  if (resolved === null || resolved === undefined) return "";
  if (typeof resolved === "string") return resolved;
  if (typeof resolved === "number" || typeof resolved === "boolean") {
    return String(resolved);
  }
  return "";
}

function resolveTemplateAction(
  value: string | RenderedViewAction,
  scope: RendererUiScope,
): RenderedViewAction {
  const resolved =
    typeof value === "string" ? resolveTemplateValue(value, scope) : value;
  if (isRendererAction(resolved)) return normalizeRendererAction(resolved);
  const label =
    resolved === null || resolved === undefined ? "Submit" : String(resolved);
  const id = actionIdFromLabel(label);
  return { id, label, response: id };
}

function resolveRepeatedChildren(
  template: Extract<RendererUiTemplateNode, { type: "stack" | "row" | "list" }>,
  scope: RendererUiScope,
): RenderedViewUiNode[] {
  if (!template.for) {
    return (template.children ?? [])
      .map((child) => resolveRendererUiTemplate(child, scope))
      .filter((child): child is RenderedViewUiNode => Boolean(child));
  }
  const value = resolveTemplateValue(template.for, scope);
  if (!Array.isArray(value) || !template.item) return [];
  const localName = template.as ?? "item";
  return value
    .map((item, index) =>
      resolveRendererUiTemplate(template.item as RendererUiTemplateNode, {
        data: scope.data,
        locals: {
          ...(scope.locals ?? {}),
          [localName]: item,
          index,
        },
      }),
    )
    .filter((child): child is RenderedViewUiNode => Boolean(child));
}

function resolveRendererUiTemplate(
  template: RendererUiTemplateNode,
  scope: RendererUiScope,
): RenderedViewUiNode | null {
  if (
    template.type === "stack" ||
    template.type === "row" ||
    template.type === "list"
  ) {
    return {
      type: template.type,
      children: resolveRepeatedChildren(template, scope),
    };
  }
  if (template.type === "text") {
    return {
      type: "text",
      value: resolveTemplateString(template.value, scope),
      ...(template.variant ? { variant: template.variant } : {}),
    };
  }
  if (template.type === "markdown") {
    return {
      type: "markdown",
      value: resolveTemplateString(template.value, scope),
    };
  }
  if (template.type === "input") {
    return {
      type: "input",
      value: resolveTemplateString(template.value, scope),
      ...(template.label
        ? { label: resolveTemplateString(template.label, scope) }
        : {}),
      readOnly: template.readOnly ?? true,
    };
  }
  if (template.type === "button") {
    const action = resolveTemplateAction(template.action, scope);
    return {
      type: "button",
      label: resolveTemplateString(template.label, scope) || action.label,
      action,
    };
  }
  if (template.type === "checkbox") {
    return {
      type: "checkbox",
      name: template.name,
      value: resolveTemplateString(template.value, scope),
      label: resolveTemplateString(template.label, scope),
    };
  }
  if (template.type === "submit") {
    return {
      type: "submit",
      label: resolveTemplateString(template.label, scope) || "Submit",
    };
  }
  return null;
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

function rendererDataKeySet(definition: ViewRendererDefinition): Set<string> {
  return new Set(Object.keys(definition.data ?? {}));
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

function firstStringField(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field.trim();
    if (typeof field === "number" || typeof field === "boolean") {
      return String(field);
    }
  }
  return null;
}

function firstStringValue(value: Record<string, unknown>): string | null {
  for (const field of Object.values(value)) {
    if (typeof field === "string" && field.trim()) return field.trim();
    if (typeof field === "number" || typeof field === "boolean") {
      return String(field);
    }
  }
  return null;
}

function recordLooksLikeChoice(value: Record<string, unknown>): boolean {
  return ["label", "title", "name", "slug", "id", "value", "response"].some(
    (key) => Object.prototype.hasOwnProperty.call(value, key),
  );
}

function normalizeRendererListItem(
  value: unknown,
): z.infer<typeof RendererActionDefaultSchema> | null {
  if (typeof value === "string") return normalizeRendererAction(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return normalizeRendererAction(String(value));
  }
  if (isRendererAction(value)) return normalizeRendererAction(value);
  if (!isRecord(value)) return null;
  const label =
    firstStringField(value, [
      "label",
      "title",
      "name",
      "slug",
      "id",
      "value",
      "response",
    ]) ?? firstStringValue(value);
  if (!label) return null;
  const response =
    firstStringField(value, [
      "response",
      "slug",
      "id",
      "value",
      "title",
      "label",
      "name",
    ]) ?? label;
  const rawId =
    firstStringField(value, ["id", "slug", "value", "response"]) ?? response;
  return {
    id: actionIdFromLabel(rawId),
    label,
    response,
  };
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
): Array<z.infer<typeof RendererActionDefaultSchema>> | null {
  if (Array.isArray(value)) {
    const items = value.map(normalizeRendererListItem);
    return items.every(Boolean)
      ? (items as Array<z.infer<typeof RendererActionDefaultSchema>>)
      : null;
  }
  if (!isRecord(value)) {
    const item = normalizeRendererListItem(value);
    return item ? [item] : null;
  }

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

  if (recordLooksLikeChoice(value)) {
    const item = normalizeRendererListItem(value);
    return item ? [item] : null;
  }

  return listItemsFromValue(Object.values(value));
}

function isListRendererField(
  definition: ViewRendererDefinition,
  bind: string,
): boolean {
  const type = definition.data?.[bind]?.type ?? "value";
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
    return items;
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
  for (const bind of rendererDataKeySet(definition)) {
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
  return [...rendererDataKeySet(definition)].map((bind) => {
    const field = definition.data?.[bind];
    const type = field?.type ?? "value";
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
  "item",
  "items",
  "kody",
  "list",
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

function rendererMatchTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 2 || RENDERER_MATCH_STOP_WORDS.has(raw)) continue;
    tokens.add(raw);
    if (raw.endsWith("ies") && raw.length > 4) {
      tokens.add(`${raw.slice(0, -3)}y`);
    }
    if (raw.endsWith("ion") && raw.length > 5) {
      tokens.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ing") && raw.length > 5) {
      tokens.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ed") && raw.length > 4) {
      tokens.add(raw.slice(0, -2));
    }
    if (raw.endsWith("s") && raw.length > 3) {
      tokens.add(raw.slice(0, -1));
    }
  }
  return tokens;
}

function rendererMatchWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function rendererMatchPhrases(text: string): Set<string> {
  const words = rendererMatchWords(text);
  const phrases = new Set<string>();
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const slice = words.slice(index, index + size);
      if (slice.every((word) => RENDERER_MATCH_STOP_WORDS.has(word))) {
        continue;
      }
      phrases.add(slice.join(" "));
    }
  }
  return phrases;
}

function rendererDefinitionMatchText(
  definition: ViewRendererDefinition,
): string {
  return [
    definition.slug,
    definition.name,
    definition.description,
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

function rendererUserTextScore(
  definition: ViewRendererDefinition,
  userText: string | null | undefined,
): number {
  const userTokens = rendererMatchTokens(userText ?? "");
  if (userTokens.size === 0) return 0;
  const definitionText = rendererDefinitionMatchText(definition);
  const definitionTokens = rendererMatchTokens(definitionText);
  let score = 0;
  for (const token of userTokens) {
    if (definitionTokens.has(token)) score += 1;
  }
  const userPhrases = rendererMatchPhrases(userText ?? "");
  const definitionPhrases = rendererMatchPhrases(definitionText);
  for (const phrase of userPhrases) {
    if (definitionPhrases.has(phrase)) score += 3;
  }
  return score;
}

export function matchViewRendererDefinition(
  definitions: ViewRendererDefinition[],
  purpose: string,
  data: Record<string, unknown>,
  userText?: string | null,
): ViewRendererDefinition | null {
  const dataKeys = Object.keys(data).filter((key) => data[key] !== undefined);
  if (dataKeys.length === 0) return null;
  const hasUserText = Boolean(userText?.trim());
  const matches = definitions
    .map((definition, index) => {
      const purposeMatched =
        definition.purpose === purpose ||
        definition.slug === purpose ||
        definition.aliases?.includes(purpose) === true;
      const userTextScore = rendererUserTextScore(definition, userText);
      const binds = rendererDataKeySet(definition);
      const matched = dataKeys.filter((key) => binds.has(key)).length;
      const missing = [...binds].filter(
        (bind) => !dataKeys.includes(bind),
      ).length;
      return {
        definition,
        index,
        matched,
        missing,
        bindCount: binds.size,
        purposeMatched,
        userTextScore,
      };
    })
    .filter(
      (candidate) =>
        candidate.matched > 0 &&
        (candidate.purposeMatched ||
          (hasUserText && candidate.userTextScore > 0)),
    )
    .sort((a, b) => {
      if (a.missing !== b.missing) return a.missing - b.missing;
      if (hasUserText && a.userTextScore !== b.userTextScore) {
        return b.userTextScore - a.userTextScore;
      }
      if (a.purposeMatched !== b.purposeMatched) {
        return a.purposeMatched ? -1 : 1;
      }
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
  userText,
}: {
  octokit?: Octokit;
  owner?: string;
  repo?: string;
  purpose: string;
  data: Record<string, unknown>;
  userText?: string | null;
}): Promise<ViewRendererDefinitionFile> {
  const files =
    octokit && owner && repo
      ? await listViewRendererDefinitionFiles({ octokit, owner, repo })
      : [];
  const definitions = files.map((file) => file.definition);
  const matched = matchViewRendererDefinition(
    definitions,
    purpose,
    data,
    userText,
  );
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
