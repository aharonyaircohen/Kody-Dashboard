/**
 * @fileType util
 * @domain kody
 * @pattern agent-slug
 * @ai-summary Shared slug normalization for state-repo agent files.
 */

import { normalizeSlug, slugifyTitle } from "./slug";

export function slugifyAgentTitle(title: string): string {
  return slugifyTitle(title);
}

export function normalizeAgentSlug(input: string): string {
  return normalizeSlug(input, "agent");
}
