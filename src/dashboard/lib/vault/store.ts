/**
 * @fileType utility
 * @domain vault
 * @pattern state-repo
 * @ai-summary Read/write repo encrypted vault in the configured external state
 * repo. Caches decrypted contents per repo for short polling windows.
 */

import type { Octokit } from "@octokit/rest";

import { logger } from "@dashboard/lib/logger";
import { readStateText, writeStateText } from "@dashboard/lib/state-repo";

import { decrypt, deriveKeyCheck, encrypt } from "./crypto";

export const VAULT_PATH = "secrets.enc";

export interface VaultSecretMeta {
  /** ISO timestamp of last update. */
  updatedAt: string;
  /** GitHub login of last writer. */
  updatedBy?: string;
}

export interface VaultEntry extends VaultSecretMeta {
  value: string;
}

export interface VaultDocument {
  version: 1;
  secrets: Record<string, VaultEntry>;
  /** SHA-256 of KODY_MASTER_KEY; set on first vault write. */
  keyCheck?: string;
}

interface CacheEntry {
  doc: VaultDocument;
  sha: string | null;
  expiresAt: number;
}

const CACHE = new Map<string, CacheEntry>();
const INFLIGHT = new Map<
  string,
  Promise<{ doc: VaultDocument; sha: string | null }>
>();
const TTL_MS = 60_000;

function cacheKey(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function emptyDoc(): VaultDocument {
  return { version: 1, secrets: {} };
}

async function fetchRaw(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ doc: VaultDocument; sha: string | null }> {
  const file = await readStateText(octokit, owner, repo, VAULT_PATH, {
    headers: { "If-None-Match": "" },
  });

  if (!file) return { doc: emptyDoc(), sha: null };

  const ciphertext = file.content.trim();
  if (!ciphertext) return { doc: emptyDoc(), sha: file.sha };

  const plaintext = decrypt(ciphertext);
  const parsed = JSON.parse(plaintext) as VaultDocument;
  if (parsed.version !== 1 || typeof parsed.secrets !== "object") {
    throw new Error("Vault document has unexpected shape");
  }

  return { doc: parsed, sha: file.sha };
}

export async function readVault(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: { force?: boolean } = {},
): Promise<{ doc: VaultDocument; sha: string | null }> {
  const key = cacheKey(owner, repo);
  if (!options.force) {
    const cached = CACHE.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { doc: cached.doc, sha: cached.sha };
    }
  }

  const inflight = INFLIGHT.get(key);
  if (inflight) return inflight;

  const promise = fetchRaw(octokit, owner, repo)
    .then((result) => {
      CACHE.set(key, {
        doc: result.doc,
        sha: result.sha,
        expiresAt: Date.now() + TTL_MS,
      });
      return result;
    })
    .finally(() => {
      INFLIGHT.delete(key);
    });

  INFLIGHT.set(key, promise);
  return promise;
}

export async function writeVault(
  octokit: Octokit,
  owner: string,
  repo: string,
  doc: VaultDocument,
  currentSha: string | null,
  commitMessage = "chore(vault): update dashboard secrets",
): Promise<{ sha: string }> {
  const docToWrite: VaultDocument = doc.keyCheck
    ? doc
    : { ...doc, keyCheck: deriveKeyCheck(process.env.KODY_MASTER_KEY ?? "") };
  const ciphertext = encrypt(JSON.stringify(docToWrite));

  const { sha: newSha } = await writeStateText({
    octokit,
    owner,
    repo,
    path: VAULT_PATH,
    content: ciphertext,
    message: commitMessage,
    sha: currentSha ?? undefined,
  });

  CACHE.set(cacheKey(owner, repo), {
    doc: docToWrite,
    sha: newSha,
    expiresAt: Date.now() + TTL_MS,
  });

  if (!newSha) {
    logger.warn({ owner, repo }, "vault: GitHub returned no sha after write");
    return { sha: "" };
  }

  return { sha: newSha };
}

export function invalidateVaultCache(owner: string, repo: string): void {
  CACHE.delete(cacheKey(owner, repo));
}

export function listSecretMetadata(doc: VaultDocument): Array<{
  name: string;
  updatedAt: string;
  updatedBy?: string;
}> {
  return Object.entries(doc.secrets)
    .map(([name, entry]) => ({
      name,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
