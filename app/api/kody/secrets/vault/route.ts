/**
 * @fileType api-endpoint
 * @domain vault
 * @pattern secrets-api
 * @ai-summary POST — verify a master key and return decrypted secret values.
 *   Used by the Secrets page unlock flow. Modern vaults verify against the
 *   stored keyCheck; legacy vaults without keyCheck fall back to the configured
 *   server key. Returns 400 if the key is wrong.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireKodyAuth,
  getUserOctokit,
  getRequestAuth,
} from "@dashboard/lib/auth";
import { readVault } from "@dashboard/lib/vault/store";
import {
  deriveKeyCheck,
  isVaultConfigured,
  verifyKey,
} from "@dashboard/lib/vault/crypto";
import { logger } from "@dashboard/lib/logger";

const UnlockSchema = z.object({
  key: z.string().min(1),
});

function vaultUnconfiguredResponse() {
  return NextResponse.json(
    {
      error: "vault_not_configured",
      message:
        "KODY_MASTER_KEY is not set on the server. Run `pnpm vault:init` and add the key to Vercel env.",
    },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;
  if (!isVaultConfigured()) return vaultUnconfiguredResponse();

  const auth = getRequestAuth(req);
  if (!auth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }

  const octokit = await getUserOctokit(req);
  if (!octokit)
    return NextResponse.json({ error: "no_octokit" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = UnlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  try {
    const { doc } = await readVault(octokit, auth.owner, auth.repo, {
      force: true,
    });

    // Legacy vaults may predate keyCheck. In that case, validate against the
    // configured server key instead of blocking unlock entirely.
    const keyCheck =
      doc.keyCheck ?? deriveKeyCheck(process.env.KODY_MASTER_KEY ?? "");

    if (!verifyKey(parsed.data.key, keyCheck)) {
      return NextResponse.json(
        { error: "wrong_key", message: "The master key is incorrect." },
        { status: 400 },
      );
    }

    const secrets = Object.entries(doc.secrets)
      .map(([name, entry]) => ({
        name,
        value: entry.value,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ secrets });
  } catch (err) {
    logger.error(
      { err, owner: auth.owner, repo: auth.repo },
      "vault: unlock failed",
    );
    return NextResponse.json(
      { error: "vault_read_failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
