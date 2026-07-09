/**
 * @fileType hook
 * @domain chat-plugin-commands
 * @pattern slash-commands
 * @ai-summary React-query hook that fetches the merged command list
 *   (builtins + repo) and provides parse/match helpers for the chat
 *   composer. Kept separate from the API surface so the chat component
 *   doesn't need to know about builtins vs repo files. The commands DATA
 *   layer (files/index/substitute + API routes) stays in `lib/commands/`
 *   — it is shared with the /commands page; only the chat-composer wiring
 *   lives in this plugin (Step 5b).
 */
"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildAuthHeaders, type KodyAuth } from "../../../auth-context";
import {
  substitute,
  type SubstituteResult,
} from "../../../commands/substitute";

export interface SlashCommand {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
  source: "repo" | "store" | "builtin";
}

interface ListResponse {
  commands?: SlashCommand[];
}

export const slashCommandsQueryKey = ["kody-commands"] as const;

async function fetchCommands(
  headers: Record<string, string>,
): Promise<SlashCommand[]> {
  const res = await fetch("/api/kody/commands", { headers });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as ListResponse;
  return json.commands ?? [];
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
 * If the input is a "/slug args…" form and slug matches a known command,
 * return the expanded text. Otherwise return null (caller sends as-is).
 */
export function expandSlashCommand(
  input: string,
  commands: SlashCommand[],
): (SubstituteResult & { slug: string }) | null {
  if (!input.startsWith("/")) return null;
  const rest = input.slice(1);
  const spaceIdx = rest.search(/\s/);
  const slug = spaceIdx < 0 ? rest : rest.slice(0, spaceIdx);
  if (!slug) return null;
  const command = commands.find((p) => p.slug === slug);
  if (!command) return null;
  const args = spaceIdx < 0 ? "" : rest.slice(spaceIdx + 1);
  const result = substitute(command.body, args);
  return { ...result, slug };
}

export function useSlashCommands(auth: KodyAuth | null): {
  commands: SlashCommand[];
  loading: boolean;
} {
  const headers: Record<string, string> = useMemo(
    () => ({ "Content-Type": "application/json", ...buildAuthHeaders(auth) }),
    [auth],
  );
  const { data, isLoading } = useQuery<SlashCommand[]>({
    queryKey: slashCommandsQueryKey,
    queryFn: () => fetchCommands(headers),
    enabled: !!auth,
    staleTime: 60_000,
  });
  return { commands: data ?? [], loading: isLoading };
}
