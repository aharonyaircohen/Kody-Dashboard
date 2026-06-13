/**
 * @fileType util
 * @domain inbox
 * @pattern chat-tools
 * @ai-summary Read-only chat tool for the operator inbox (the gist-backed
 *   queue of mentions + CTO recommendations). Lists entries so chat can
 *   summarize "what's waiting on me". Acting on a recommendation
 *   (approve/reject/dismiss) stays on the /inbox page — that path writes the
 *   trust ledger and is intentionally not exposed to chat yet.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { readInbox } from "@dashboard/lib/inbox/gist-store";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
}

export function createInboxTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  return {
    list_inbox: tool({
      description: `List the operator's inbox entries (mentions + CTO recommendations waiting for a decision). Returns each entry's title, source, author, url, and read state. Use to answer "what's in my inbox / what needs my attention".`,
      inputSchema: z.object({
        unreadOnly: z.boolean().default(false),
      }),
      execute: async ({ unreadOnly }) => {
        try {
          const { gistId, manifest } = await readInbox(octokit, owner, repo);
          let entries = manifest.entries;
          if (unreadOnly) entries = entries.filter((e) => e.readAt == null);
          return {
            gistId,
            count: entries.length,
            entries: entries.map((e) => ({
              id: e.id,
              source: e.source,
              title: e.title,
              snippet: e.snippet,
              author: e.author,
              url: e.url,
              read: e.readAt != null,
              ctoAction: e.ctoAction,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
