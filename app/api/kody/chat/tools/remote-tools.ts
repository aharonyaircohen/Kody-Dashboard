/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Remote dev tools for the kody-direct chat agent.
 *
 * Calls the per-user Tailscale Funnel agent in-process (no extra HTTP
 * hop through /api/kody/remote/exec). Exported only when the requester
 * has a remote config — without one, the factory returns {} so the
 * model is never told about tools it cannot invoke.
 */
import { tool } from "ai";
import { z } from "zod";
import { getRemoteConfig } from "@dashboard/lib/remote-config";
import { logger } from "@dashboard/lib/logger";

const REMOTE_TIMEOUT_MS = 60_000;

async function callAgent(
  funnelUrl: string,
  key: string,
  action: "exec" | "read" | "write" | "ls",
  payload: Record<string, unknown>,
): Promise<unknown> {
  const url = `${funnelUrl.replace(/\/$/, "")}/${action}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: (data as { error?: string }).error ?? `HTTP ${res.status}`,
      };
    }
    return data;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "Remote agent timed out after 60s" };
    }
    return {
      error:
        err instanceof Error ? err.message : "Failed to reach remote agent",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createRemoteTools(actorLogin: string | null | undefined) {
  if (!actorLogin) return {};
  const cfg = getRemoteConfig(actorLogin);
  if (!cfg) return {};

  return {
    remote_implementation: tool({
      description:
        "Execute a shell command on the user's remote Mac dev environment. " +
        "30s timeout, 512KB stdout cap. Use for read-only diagnostics by default " +
        "(e.g. `ls`, `git status`, `pnpm test`); be cautious with destructive commands.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe("Shell command to run on the remote Mac"),
        cwd: z
          .string()
          .optional()
          .describe("Optional working directory for the command"),
      }),
      execute: async ({ command, cwd }) => {
        logger.info({ actorLogin, action: "exec", command }, "remote_implementation");
        return callAgent(cfg.funnelUrl, cfg.key, "exec", { command, cwd });
      },
    }),

    remote_read: tool({
      description:
        "Read a file from the user's remote Mac dev environment (1 MB max).",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path to read"),
      }),
      execute: async ({ path }) => {
        logger.info({ actorLogin, action: "read", path }, "remote_read");
        return callAgent(cfg.funnelUrl, cfg.key, "read", { path });
      },
    }),

    remote_write: tool({
      description:
        "Write a file to the user's remote Mac dev environment. Confirm with " +
        "the user before calling — this is destructive and runs with their " +
        "local permissions.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute path to write"),
        content: z.string().describe("UTF-8 content to write"),
      }),
      execute: async ({ path, content }) => {
        logger.info(
          { actorLogin, action: "write", path, bytes: content.length },
          "remote_write",
        );
        return callAgent(cfg.funnelUrl, cfg.key, "write", { path, content });
      },
    }),

    remote_ls: tool({
      description:
        "List directory contents on the user's remote Mac dev environment.",
      inputSchema: z.object({
        path: z.string().min(1).describe("Absolute directory path to list"),
      }),
      execute: async ({ path }) => {
        logger.info({ actorLogin, action: "ls", path }, "remote_ls");
        return callAgent(cfg.funnelUrl, cfg.key, "ls", { path });
      },
    }),
  };
}
