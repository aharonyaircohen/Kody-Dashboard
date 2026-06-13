/**
 * @fileType utility
 * @domain kody
 * @pattern scenario-files
 * @ai-summary Shared validation helpers for scenario/prototype local files.
 */
import path from "path";

const SAFE_FILE_STEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SCENARIO_CATEGORIES = new Set(["core", "feature", "edge"]);

export function parseScenarioCategory(value: unknown): string | null {
  const category = typeof value === "string" ? value : "feature";
  return SCENARIO_CATEGORIES.has(category) ? category : null;
}

export function parseSafeFileStem(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const stem = value.trim().replace(/\.html$/i, "");
  if (!SAFE_FILE_STEM.test(stem)) return null;
  if (stem === "." || stem === ".." || stem.includes("..")) return null;
  return stem;
}

export function resolveUnderBase(
  basePath: string,
  ...segments: string[]
): string | null {
  const base = path.resolve(basePath);
  const resolved = path.resolve(base, ...segments);
  if (resolved === base || resolved.startsWith(base + path.sep)) {
    return resolved;
  }
  return null;
}
