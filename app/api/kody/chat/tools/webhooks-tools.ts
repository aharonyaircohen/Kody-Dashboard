/**
 * @fileType util
 * @domain webhooks
 * @pattern chat-tools
 * @ai-summary Chat tool to register/refresh the GitHub webhook for the
 *   connected repo (points at /api/webhooks/github). Idempotent via the
 *   shared ensureWebhook helper. Needs the raw PAT (not just an octokit), so
 *   it's wired with repo.token explicitly.
 */
import { tool } from "ai";
import { z } from "zod";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";

interface Ctx {
  token: string;
  owner: string;
  repo: string;
}

export function createWebhookTools(ctx: Ctx) {
  const { token, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;
  return {
    register_webhook: tool({
      description: `Register or refresh the GitHub webhook on ${repoRef} so the dashboard receives push-based cache invalidation and mention notifications. Idempotent — safe to call repeatedly. Requires NEXT_PUBLIC_SERVER_URL to be set on the server and the token to have admin:repo_hook (the classic repo scope includes it).`,
      inputSchema: z.object({}),
      execute: async () => {
        const base = process.env.NEXT_PUBLIC_SERVER_URL;
        if (!base)
          return {
            error: "no_server_url",
            message: "NEXT_PUBLIC_SERVER_URL is not set on the server, so the webhook target URL is unknown.",
          };
        try {
          const result = await ensureWebhook({
            token,
            owner,
            repo,
            hookUrl: `${base}/api/webhooks/github`,
          });
          return result;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
