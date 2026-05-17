/**
 * @fileType api-endpoint
 * @domain vault
 * @pattern secrets-api
 * @ai-summary DELETE /api/kody/secrets/[name] — remove a secret from the vault.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import {
  invalidateVaultCache,
  listSecretMetadata,
  readVault,
  writeVault,
} from "@dashboard/lib/vault/store";
import { isVaultConfigured } from "@dashboard/lib/vault/crypto";
import { recordAction } from "@dashboard/lib/activity/action-log";
import { logger } from "@dashboard/lib/logger";

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  if (!isVaultConfigured()) {
    return NextResponse.json(
      { error: "vault_not_configured" },
      { status: 503 },
    );
  }

  const { name } = await context.params;
  if (!name) {
    return NextResponse.json({ error: "missing_name" }, { status: 400 });
  }

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  try {
    const { doc, sha } = await readVault(octokit, auth.owner, auth.repo, {
      force: true,
    });
    if (!(name in doc.secrets)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const nextSecrets = { ...doc.secrets };
    delete nextSecrets[name];
    const next = { ...doc, secrets: nextSecrets };
    await writeVault(
      octokit,
      auth.owner,
      auth.repo,
      next,
      sha,
      `chore(vault): delete ${name}`,
    );
    invalidateVaultCache(auth.owner, auth.repo);
    recordAction({
      type: "vault.delete",
      target: name,
      repo: `${auth.owner}/${auth.repo}`,
      detail: "delete secret",
    });
    return NextResponse.json({ ok: true, secrets: listSecretMetadata(next) });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo, name },
      "vault: delete failed",
    );
    return NextResponse.json(
      { error: "vault_write_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
