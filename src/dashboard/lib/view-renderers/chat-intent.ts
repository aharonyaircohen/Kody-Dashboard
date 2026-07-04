/**
 * @fileType util
 * @domain view-renderers
 * @pattern renderer-intent-routing
 * @ai-summary Decides when a chat turn should end with a user-managed renderer.
 */
import type { ViewRendererDefinition } from "./renderers";
import type { RenderedViewUiNode } from "@dashboard/lib/chat-ui-actions";

const RENDERER_INTENT_STOP_WORDS = new Set([
  "a",
  "all",
  "an",
  "and",
  "as",
  "available",
  "data",
  "from",
  "in",
  "is",
  "it",
  "item",
  "keys",
  "kody",
  "list",
  "me",
  "one",
  "optional",
  "purpose",
  "the",
  "to",
  "use",
  "user",
  "when",
]);

function tokenStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const raw of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 2 || RENDERER_INTENT_STOP_WORDS.has(raw)) continue;
    stems.add(raw);
    if (raw.endsWith("ies") && raw.length > 4) {
      stems.add(`${raw.slice(0, -3)}y`);
    }
    if (raw.endsWith("ion") && raw.length > 5) {
      stems.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ing") && raw.length > 5) {
      stems.add(raw.slice(0, -3));
    }
    if (raw.endsWith("ed") && raw.length > 4) {
      stems.add(raw.slice(0, -2));
    }
    if (raw.endsWith("s") && raw.length > 3) {
      stems.add(raw.slice(0, -1));
    }
  }
  return stems;
}

function rendererIntentText(definition: ViewRendererDefinition): string {
  return [
    definition.slug,
    definition.name,
    definition.description,
    definition.purpose,
    ...(definition.aliases ?? []),
    definition.rule,
    ...uiNodeText(definition.ui),
    ...Object.entries(definition.data ?? {}).flatMap(([key, field]) => [
      key,
      field.type,
      field.description,
    ]),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function uiNodeText(node: ViewRendererDefinition["ui"]): string[] {
  if (node.type === "stack" || node.type === "row" || node.type === "list") {
    return [
      node.type,
      node.for,
      node.as,
      ...(node.children ?? []).flatMap(uiNodeText),
      ...(node.item ? uiNodeText(node.item) : []),
    ].filter((value): value is string => typeof value === "string");
  }
  return Object.values(node).filter(
    (value): value is string => typeof value === "string",
  );
}

function uiHasInteractiveAtom(node: ViewRendererDefinition["ui"]): boolean {
  if (
    node.type === "button" ||
    node.type === "checkbox" ||
    node.type === "submit"
  ) {
    return true;
  }
  if (node.type !== "stack" && node.type !== "row" && node.type !== "list") {
    return false;
  }
  return (
    (node.children ?? []).some(uiHasInteractiveAtom) ||
    Boolean(node.item && uiHasInteractiveAtom(node.item))
  );
}

function rendererSupportsUserInteraction(
  definition: ViewRendererDefinition,
): boolean {
  return uiHasInteractiveAtom(definition.ui);
}

function looksLikeAssistantInteraction(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("?")) return false;
  return (
    /\b(?:which|choose|pick|select)\b/i.test(trimmed) ||
    /\b(?:want|would|should|shall|can)\s+(?:me|i|we|you)\b/i.test(trimmed) ||
    /\b(?:confirm|approve|continue|cancel|edit|ok)\b/i.test(trimmed) ||
    /\bor\s+(?:should|do|would|want|I|we|you)\b/i.test(trimmed)
  );
}

export function shouldRequireViewOutputForTurn({
  userText,
  definitions,
}: {
  userText: string | null | undefined;
  definitions: readonly ViewRendererDefinition[];
}): boolean {
  const userStems = tokenStems(userText ?? "");
  if (userStems.size === 0 || definitions.length === 0) return false;
  const rendererStems = tokenStems(
    definitions.map(rendererIntentText).join(" "),
  );
  for (const stem of userStems) {
    if (rendererStems.has(stem)) return true;
  }
  return false;
}

export function shouldRequireViewOutputForAssistantText({
  assistantText,
  definitions,
}: {
  assistantText: string | null | undefined;
  definitions: readonly ViewRendererDefinition[];
}): boolean {
  const text = assistantText?.trim();
  if (!text || definitions.length === 0) return false;
  if (!looksLikeAssistantInteraction(text)) return false;
  return definitions.some(rendererSupportsUserInteraction);
}

function isReadLikeToolName(toolName: string): boolean {
  return /^(list|read|get|search|fetch|describe)_/.test(toolName);
}

export function shouldAllowPreRenderToolCallsForTurn({
  userText,
  toolNames,
}: {
  userText: string | null | undefined;
  toolNames: Iterable<string>;
}): boolean {
  const userStems = tokenStems(userText ?? "");
  if (userStems.size === 0) return false;
  for (const toolName of toolNames) {
    if (!isReadLikeToolName(toolName)) continue;
    const toolStems = tokenStems(toolName.replace(/_/g, " "));
    for (const stem of userStems) {
      if (toolStems.has(stem)) return true;
    }
  }
  return false;
}
