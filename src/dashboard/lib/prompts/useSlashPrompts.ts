/**
 * @fileType hook
 * @domain prompts
 * @pattern slash-commands
 * @ai-summary React-query hook that fetches the merged prompt list
 *   (builtins + repo) and provides parse/match helpers for the chat
 *   composer. Kept separate from the API surface so the chat component
 *   doesn't need to know about builtins vs repo files.
 */
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildAuthHeaders, type KodyAuth } from "../auth-context";
import { substitute, type SubstituteResult } from "./substitute";

export interface SlashPrompt {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
  source: "repo" | "builtin";
}

interface ListResponse {
  prompts?: SlashPrompt[];
}

export const slashPromptsQueryKey = ["kody-prompts"] as const;

async function fetchPrompts(
  headers: Record<string, string>,
): Promise<SlashPrompt[]> {
  const res = await fetch("/api/kody/prompts", { headers });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as ListResponse;
  return json.prompts ?? [];
}

/**
 * Detect whether the input looks like a slash command "in progress"
 * (cursor still in the slug). The menu opens while this is true.
 *
 * - "/" → match-all open
 * - "/rev" → filter by prefix "rev"
 * - "/review " (trailing space) → slug is committed; menu closes, args mode
 * - "/review arg" → committed; menu closed
 * - "foo /review" → not at start; not a slash command
 */
export function parseSlashTrigger(input: string): {
  active: boolean;
  filter: string;
} {
  if (!input.startsWith("/")) return { active: false, filter: "" };
  // After the slash, until the first whitespace.
  const rest = input.slice(1);
  const spaceIdx = rest.search(/\s/);
  if (spaceIdx >= 0) return { active: false, filter: rest.slice(0, spaceIdx) };
  return { active: true, filter: rest };
}

/**
 * If the input is a "/slug args…" form and slug matches a known prompt,
 * return the expanded text. Otherwise return null (caller sends as-is).
 */
export function expandSlashCommand(
  input: string,
  prompts: SlashPrompt[],
): (SubstituteResult & { slug: string }) | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  const spaceIdx = rest.search(/\s/);
  const slug = spaceIdx < 0 ? rest : rest.slice(0, spaceIdx);
  if (!slug) return null;
  const prompt = prompts.find((p) => p.slug === slug);
  if (!prompt) return null;
  const args = spaceIdx < 0 ? "" : rest.slice(spaceIdx + 1);
  const result = substitute(prompt.body, args);
  return { ...result, slug };
}

export function useSlashPrompts(auth: KodyAuth | null): {
  prompts: SlashPrompt[];
  loading: boolean;
} {
  const headers: Record<string, string> = useMemo(
    () => ({ "Content-Type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const { data, isLoading } = useQuery<SlashPrompt[]>({
    queryKey: slashPromptsQueryKey,
    queryFn: () => fetchPrompts(headers),
    enabled: !!auth,
    staleTime: 60_000,
  });
  return { prompts: data ?? [], loading: isLoading };
}
