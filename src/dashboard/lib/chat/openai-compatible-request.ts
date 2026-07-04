/**
 * @fileType utility
 * @domain kody
 * @pattern provider-request-normalizer
 * @ai-summary Normalizes OpenAI-compatible chat request bodies before they
 *   leave Kody. Tool execution still validates with the original Zod schemas;
 *   this only removes validation-only JSON Schema keywords from the
 *   provider-facing copy so stricter compatible endpoints accept Kody's large
 *   generic tool set.
 */

const TOOL_SCHEMA_VALIDATION_KEYWORDS = new Set([
  "$schema",
  "additionalProperties",
  "default",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "pattern",
]);

function stripValidationKeywords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripValidationKeywords);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (TOOL_SCHEMA_VALIDATION_KEYWORDS.has(key)) continue;
    out[key] = stripValidationKeywords(child);
  }
  return out;
}

function normalizeTool(toolValue: unknown): unknown {
  if (!toolValue || typeof toolValue !== "object" || Array.isArray(toolValue)) {
    return toolValue;
  }

  const tool = toolValue as Record<string, unknown>;
  const fn = tool.function;
  if (!fn || typeof fn !== "object" || Array.isArray(fn)) return toolValue;

  const functionShape = fn as Record<string, unknown>;
  return {
    ...tool,
    function: {
      ...functionShape,
      parameters: stripValidationKeywords(functionShape.parameters),
    },
  };
}

export function normalizeOpenAICompatibleRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(body.tools)) return body;
  return {
    ...body,
    tools: body.tools.map(normalizeTool),
  };
}
