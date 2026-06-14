/**
 * @fileType utility
 * @domain kody
 * @pattern engine-install
 * @ai-summary One-shot engine installer for a consumer repo.
 *
 * Commits the dashboard-compatible `kody.yml` to
 * `.github/workflows/kody.yml` in the target repo, (best-effort) writes the
 * user's PAT as the
 * `KODY_TOKEN` Actions secret so the engine has GitHub auth at runtime,
 * (best-effort) decrypts the per-repo vault (`.kody/secrets.enc`) and
 * mirrors every entry into the consumer repo's Actions secrets so the
 * engine has provider API keys at runtime, and (best-effort) registers
 * the dashboard webhook so push-based cache invalidation works from
 * day one.
 *
 * Idempotent: re-running on a configured repo syncs the workflow to the
 * bundled template, refreshes `KODY_TOKEN`, re-mirrors the vault, and
 * refreshes the webhook subscription.
 *
 * Secret writes need `repo:secrets:write` on the PAT (a normal `repo`-
 * scoped fine-grained PAT covers this). When that fails we soft-fail and
 * surface a `nextSteps` entry so the user can set the secrets manually.
 */
import type { Octokit } from "@octokit/rest";
import sodium from "libsodium-wrappers";
import { logger } from "@dashboard/lib/logger";
import { ensureWebhook } from "@dashboard/lib/webhooks/register";
import { readVault } from "@dashboard/lib/vault/store";
import {
  pickEngineDefaultModel,
  engineModelSpec,
  type ChatModel,
} from "@dashboard/lib/variables/models";
import { writeEngineModel } from "./config";

export const KODY_TOKEN_SECRET = "KODY_TOKEN";

export const WORKFLOW_TEMPLATE_SOURCE =
  "dashboard:kody-chat-compatible-workflow";
export const WORKFLOW_PATH = ".github/workflows/kody.yml";
export const VARIABLES_PATH = ".kody/variables.json";

const WORKFLOW_TEMPLATE = `# Drop this file at .github/workflows/kody.yml in your repo.
#
# Triggers forward every relevant event to kody; the engine decides what
# to do. The workflow stays thin so engine fixes ship through npm.
#
# Required repo secrets: at least one model provider key, such as
# MINIMAX_API_KEY or ANTHROPIC_API_KEY. Kody reads *_API_KEY secrets
# automatically through ALL_SECRETS.
#
# Recommended: KODY_TOKEN secret with repo, read:org, and workflow scopes.

name: kody

on:
  workflow_dispatch:
    inputs:
      executable:
        description: "Executable name (e.g. ui-review, run, fix)"
        type: string
        default: ""
      issue_number:
        description: "GitHub issue number (agent mode)"
        type: string
        default: ""
      sessionId:
        description: "Chat session ID (chat mode, from Kody-Dashboard)"
        type: string
        default: ""
      message:
        description: "Initial chat message (optional)"
        type: string
        default: ""
      model:
        description: "Model override (optional, e.g. anthropic/claude-haiku-4-5-20251001)"
        type: string
        default: ""
      dashboardUrl:
        description: "Dashboard event ingest URL with inline ?token=... (chat mode)"
        type: string
        default: ""
  issue_comment:
    types: [created]
  pull_request:
    types: [closed]
  schedule:
    - cron: "*/15 * * * *"

jobs:
  run:
    if: \${{ github.event_name != 'pull_request' || github.event.pull_request.merged == true }}
    runs-on: ubuntu-latest
    timeout-minutes: 360
    concurrency:
      group: kody-\${{ inputs.sessionId || inputs.issue_number || github.event.issue.number || github.sha }}
      cancel-in-progress: false
    permissions:
      issues: write
      pull-requests: write
      contents: write
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ github.event.pull_request.base.ref || github.ref }}
          token: \${{ secrets.KODY_TOKEN || github.token }}

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - env:
          ALL_SECRETS: \${{ toJSON(secrets) }}
          SESSION_ID: \${{ inputs.sessionId }}
          INIT_MESSAGE: \${{ inputs.message }}
          MODEL: \${{ inputs.model }}
          DASHBOARD_URL: \${{ inputs.dashboardUrl }}
        run: npx -y -p @kody-ade/kody-engine@latest kody-engine
`;

export interface InstallEngineInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  token: string;
  hookUrl: string;
  /**
   * Re-commit the template even if the workflow already matches.
   * Default false — when the file is current, no commit happens.
   */
  force?: boolean;
}

export type WorkflowAction = "created" | "updated" | "unchanged";

export interface InstallEngineResult {
  ok: true;
  workflow: {
    action: WorkflowAction;
    path: string;
    htmlUrl: string | null;
    commitSha: string | null;
    templateSource: string;
  };
  webhook: {
    ok: boolean;
    created?: boolean;
    hookId?: number;
    error?: string;
  };
  kodyTokenSecret: {
    ok: boolean;
    name: string;
    error?: string;
  };
  vaultMirror: {
    /** True when the vault was read AND at least one entry mirrored, OR the vault is empty. */
    ok: boolean;
    /** Secret names successfully written. */
    written: string[];
    /** Secret names that failed to write, with their error. */
    failed: Array<{ name: string; error: string }>;
    /** Set when reading or decrypting the vault itself failed. */
    error?: string;
  };
  nextSteps: string[];
  summary: string;
}

export interface InstallEngineFailure {
  ok: false;
  error: string;
}

function loadWorkflowTemplate(): { content: string; source: string } {
  const body = WORKFLOW_TEMPLATE;
  if (
    (!body.trim().startsWith("#") && !body.includes("name: kody")) ||
    !body.includes("sessionId:") ||
    !body.includes("DASHBOARD_URL:")
  ) {
    throw new Error(
      `Bundled workflow template did not look like chat-compatible kody.yml (got ${body.length} chars).`,
    );
  }
  return { content: body, source: WORKFLOW_TEMPLATE_SOURCE };
}

async function encryptForRepo(
  value: string,
  base64PublicKey: string,
): Promise<string> {
  await sodium.ready;
  const messageBytes = sodium.from_string(value);
  const keyBytes = sodium.from_base64(
    base64PublicKey,
    sodium.base64_variants.ORIGINAL,
  );
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

/**
 * Best-effort: encrypt `value` against the repo's Actions public key and
 * upsert it as the `secretName` repo secret. Returns `{ ok: false, error }`
 * on any failure — callers should surface the error in `nextSteps` rather
 * than aborting the install.
 */
async function setRepoActionsSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  secretName: string,
  value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data: key } = await octokit.rest.actions.getRepoPublicKey({
      owner,
      repo,
    });
    const encrypted_value = await encryptForRepo(value, key.key);
    await octokit.rest.actions.createOrUpdateRepoSecret({
      owner,
      repo,
      secret_name: secretName,
      encrypted_value,
      key_id: key.key_id,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "set_repo_secret_failed",
    };
  }
}

/**
 * Reserved Actions secret names — GitHub forbids creating these. We skip
 * silently if the vault happens to hold one (defense-in-depth; the UI
 * shouldn't allow it).
 */
const RESERVED_SECRET_PREFIXES = ["GITHUB_", "ACTIONS_"];
const VALID_SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/;

function isMirrorable(name: string): boolean {
  if (!VALID_SECRET_NAME.test(name)) return false;
  if (RESERVED_SECRET_PREFIXES.some((p) => name.startsWith(p))) return false;
  return true;
}

/**
 * Decrypt the per-repo vault and mirror every secret into the consumer
 * repo's Actions secrets so the engine sees them at runtime via
 * `toJSON(secrets)`. Soft-fail end-to-end: a vault read failure or a
 * per-entry write failure never aborts the install.
 */
async function mirrorVaultToActionsSecrets(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<InstallEngineResult["vaultMirror"]> {
  let doc: { secrets: Record<string, { value: string }> };
  try {
    const result = await readVault(octokit, owner, repo);
    doc = result.doc;
  } catch (err) {
    return {
      ok: false,
      written: [],
      failed: [],
      error:
        err instanceof Error
          ? `vault_read_failed: ${err.message}`
          : "vault_read_failed",
    };
  }

  const entries = Object.entries(doc.secrets).filter(
    ([name, entry]) => entry?.value && isMirrorable(name),
  );
  if (entries.length === 0) {
    return { ok: true, written: [], failed: [] };
  }

  const written: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const [name, entry] of entries) {
    const res = await setRepoActionsSecret(
      octokit,
      owner,
      repo,
      name,
      entry.value,
    );
    if (res.ok) written.push(name);
    else failed.push({ name, error: res.error });
  }

  return { ok: failed.length === 0, written, failed };
}

async function readExisting(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ sha: string; content: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: WORKFLOW_PATH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content)
      return null;
    return {
      sha: data.sha,
      content: Buffer.from(data.content, "base64").toString("utf-8"),
    };
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err &&
      "status" in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}

interface VariablesJson {
  LLM_MODELS?: ChatModel[];
}

async function readVariablesJson(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<{ models: ChatModel[]; sha: string | null }> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: VARIABLES_PATH,
    });
    if (Array.isArray(data) || !("content" in data) || !data.content) {
      return { models: [], sha: null };
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    const parsed = JSON.parse(content) as VariablesJson;
    return {
      models: parsed.LLM_MODELS ?? [],
      sha: data.sha ?? null,
    };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return { models: [], sha: null };
    }
    throw err;
  }
}

export async function installEngine(
  input: InstallEngineInput,
): Promise<InstallEngineResult | InstallEngineFailure> {
  const { octokit, owner, repo, token, hookUrl, force } = input;

  try {
    const { content: template, source: templateSource } =
      loadWorkflowTemplate();
    const existing = await readExisting(octokit, owner, repo);

    let workflowAction: WorkflowAction = "unchanged";
    let workflowCommitSha: string | null = null;
    let workflowHtmlUrl: string | null = null;

    if (!existing) {
      const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: WORKFLOW_PATH,
        message: "chore(kody): install engine workflow",
        content: Buffer.from(template, "utf-8").toString("base64"),
      });
      workflowAction = "created";
      workflowCommitSha = data.commit.sha ?? null;
      workflowHtmlUrl = data.content?.html_url ?? null;
    } else if (existing.content === template && !force) {
      workflowAction = "unchanged";
      workflowHtmlUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${WORKFLOW_PATH}`;
    } else {
      const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: WORKFLOW_PATH,
        message: "chore(kody): sync engine workflow to latest template",
        content: Buffer.from(template, "utf-8").toString("base64"),
        sha: existing.sha,
      });
      workflowAction = "updated";
      workflowCommitSha = data.commit.sha ?? null;
      workflowHtmlUrl = data.content?.html_url ?? null;
    }

    // Write the engine model into kody.config.json (`agent.model` — the key
    // the engine actually reads), preserving any hand-authored config. Always
    // writes a baseline (executables + github) even when no model is
    // configured yet, so the file exists for the engine to extend.
    const { models } = await readVariablesJson(octokit, owner, repo);
    const engineModel = pickEngineDefaultModel(models);
    await writeEngineModel(
      octokit,
      owner,
      repo,
      engineModel ? engineModelSpec(engineModel) : null,
    );

    const kodyTokenResult = await setRepoActionsSecret(
      octokit,
      owner,
      repo,
      KODY_TOKEN_SECRET,
      token,
    );
    const kodyTokenSecret: InstallEngineResult["kodyTokenSecret"] =
      kodyTokenResult.ok
        ? { ok: true, name: KODY_TOKEN_SECRET }
        : {
            ok: false,
            name: KODY_TOKEN_SECRET,
            error: kodyTokenResult.error,
          };

    const vaultMirror = await mirrorVaultToActionsSecrets(octokit, owner, repo);

    let webhook: InstallEngineResult["webhook"];
    try {
      const result = await ensureWebhook({ token, owner, repo, hookUrl });
      webhook = {
        ok: result.ok,
        created: result.created,
        hookId: result.hookId,
        error: result.error,
      };
    } catch (err) {
      webhook = {
        ok: false,
        error: err instanceof Error ? err.message : "webhook_register_failed",
      };
    }

    logger.info(
      {
        owner,
        repo,
        workflowAction,
        workflowCommitSha,
        webhookOk: webhook.ok,
        kodyTokenSecretOk: kodyTokenSecret.ok,
        vaultMirrorOk: vaultMirror.ok,
        vaultMirroredCount: vaultMirror.written.length,
        vaultMirrorFailedCount: vaultMirror.failed.length,
      },
      "installEngine: installed engine workflow",
    );

    const nextSteps = [
      'Pick "Kody Live" (or "Kody Live Fly") in the chat agent dropdown to ' +
        "verify the workflow runs. First dispatch cold-starts in ~30s.",
    ];
    if (vaultMirror.written.length === 0 && !vaultMirror.error) {
      nextSteps.unshift(
        "Your repo vault is empty — Kody has no LLM key to call out with. " +
          "Open Settings → Secrets in the dashboard and add at least one " +
          "provider key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), then " +
          "re-run /init so it gets mirrored to the consumer repo.",
      );
    }
    if (vaultMirror.error) {
      nextSteps.unshift(
        `Couldn't read the repo vault (${vaultMirror.error}). LLM provider ` +
          `keys were not synced to the consumer repo. Open Settings → Secrets ` +
          `to repopulate the vault, then re-run /init.`,
      );
    }
    if (vaultMirror.failed.length > 0) {
      const list = vaultMirror.failed.map((f) => f.name).join(", ");
      nextSteps.unshift(
        `Some vault entries failed to write as Actions secrets (${list}). ` +
          `The PAT used here likely lacks \`repo:secrets:write\` for those. ` +
          `Either re-mint the PAT and re-run /init, or set them by hand: ` +
          `https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      );
    }
    if (!kodyTokenSecret.ok) {
      nextSteps.unshift(
        `Couldn't auto-set the \`${KODY_TOKEN_SECRET}\` Actions secret ` +
          `(${kodyTokenSecret.error ?? "unknown error"}). The PAT used here ` +
          "likely lacks `repo:secrets:write`. Without it the engine has no " +
          "GitHub auth at runtime — labels, comments and PR updates will fail. " +
          "Either re-mint the PAT with secrets write access and re-run /init, " +
          `or add the secret by hand: ` +
          `https://github.com/${owner}/${repo}/settings/secrets/actions/new`,
      );
    }

    const tokenSummary = kodyTokenSecret.ok
      ? `${KODY_TOKEN_SECRET} secret ${workflowAction === "created" ? "set" : "refreshed"}.`
      : `${KODY_TOKEN_SECRET} secret FAILED — ${kodyTokenSecret.error ?? "unknown"}.`;
    const vaultSummary = vaultMirror.error
      ? `Vault sync FAILED — ${vaultMirror.error}.`
      : vaultMirror.written.length === 0
        ? `Vault sync: empty vault — nothing to mirror.`
        : vaultMirror.failed.length === 0
          ? `Vault sync: ${vaultMirror.written.length} secret(s) mirrored.`
          : `Vault sync: ${vaultMirror.written.length} mirrored, ${vaultMirror.failed.length} failed.`;
    const webhookSummary = webhook.ok
      ? `Webhook ${workflowAction === "created" ? "registered" : "refreshed"}.`
      : `Webhook FAILED — ${webhook.error ?? "unknown"}.`;
    const workflowSummary =
      workflowAction === "created"
        ? `Engine workflow created at ${WORKFLOW_PATH}.`
        : workflowAction === "updated"
          ? "Engine workflow updated to the bundled template."
          : "Engine workflow already matches the bundled template — no commit needed.";
    const summary = `${workflowSummary} ${tokenSummary} ${vaultSummary} ${webhookSummary}`;

    return {
      ok: true,
      workflow: {
        action: workflowAction,
        path: WORKFLOW_PATH,
        htmlUrl: workflowHtmlUrl,
        commitSha: workflowCommitSha,
        templateSource,
      },
      webhook,
      kodyTokenSecret,
      vaultMirror,
      nextSteps,
      summary,
    };
  } catch (err) {
    logger.warn({ err, owner, repo }, "installEngine failed");
    return {
      ok: false,
      error: err instanceof Error ? err.message : "install_engine_failed",
    };
  }
}
