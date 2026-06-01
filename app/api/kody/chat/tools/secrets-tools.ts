/**
 * @fileType util
 * @domain vault
 * @pattern chat-tools
 * @ai-summary Chat tools for the encrypted secrets vault
 *   (`.kody/secrets.enc`). Deliberately WRITE-ONLY from chat: list shows
 *   names + timestamps only (never values), and set upserts a value — there
 *   is NO read-back tool, so a prompt-injected message can't exfiltrate keys.
 *   Mirrors the /api/kody/secrets route's readVault → mutate → writeVault.
 */
import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import {
  readVault,
  writeVault,
  invalidateVaultCache,
  listSecretMetadata,
  type VaultDocument,
} from "@dashboard/lib/vault/store";
import { isVaultConfigured } from "@dashboard/lib/vault/crypto";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export function createSecretTools(ctx: Ctx) {
  const { octokit, owner, repo, actorLogin } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    list_secret_names: tool({
      description: `List the NAMES of secrets in ${repoRef}'s encrypted vault (with last-updated timestamps). Values are never returned — there is no way to read a secret value back through chat.`,
      inputSchema: z.object({}),
      execute: async () => {
        if (!isVaultConfigured())
          return {
            error: "vault_not_configured",
            message: "KODY_MASTER_KEY is not set on the server.",
          };
        try {
          const { doc } = await readVault(octokit, owner, repo);
          return { secrets: listSecretMetadata(doc) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    set_secret: tool({
      description: `Create or overwrite a secret value in ${repoRef}'s encrypted vault (AES-256-GCM, committed to .kody/secrets.enc). Use for API keys, tokens, etc. Names are UPPER_SNAKE_CASE. The value is write-only — it cannot be read back through chat. Confirm the value with the user before calling.`,
      inputSchema: z.object({
        name: z
          .string()
          .regex(NAME_RE, "UPPER_SNAKE_CASE, start with a letter, ≤128 chars"),
        value: z
          .string()
          .min(1)
          .max(64 * 1024),
      }),
      execute: async ({ name, value }) => {
        if (!isVaultConfigured())
          return {
            error: "vault_not_configured",
            message: "KODY_MASTER_KEY is not set on the server.",
          };
        try {
          const { doc, sha } = await readVault(octokit, owner, repo, {
            force: true,
          });
          const next: VaultDocument = {
            ...doc,
            secrets: {
              ...doc.secrets,
              [name]: {
                value,
                updatedAt: new Date().toISOString(),
                ...(actorLogin ? { updatedBy: actorLogin } : {}),
              },
            },
          };
          await writeVault(
            octokit,
            owner,
            repo,
            next,
            sha,
            `chore(vault): upsert ${name}`,
          );
          invalidateVaultCache(owner, repo);
          return { ok: true, name, secrets: listSecretMetadata(next) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
