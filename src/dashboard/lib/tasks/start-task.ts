/**
 * @fileType service
 * @domain kody
 * @pattern task-start-command
 * @ai-summary Server-owned "start task" command. The browser asks to start an
 *   issue; this service dispatches the workflow with automation credentials.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { resolveBackgroundToken } from "@dashboard/lib/auth/background-token";
import {
  addLabels,
  createUserOctokit,
  ensureLabel,
  getOctokit,
  getOwner,
  getRepo,
  getStoreRef,
  getStoreRepoUrl,
  invalidateTaskCache,
} from "@dashboard/lib/github-client";
import { KODY_BACKLOG_LABEL } from "@dashboard/lib/constants";
import { buildKodyWorkflowDispatchInputs } from "@dashboard/lib/kody-workflow-dispatch";

export interface StartTaskResult {
  success: true;
  message: string;
  issueNumber: number;
  workflowDispatched: true;
  backlogLabelApplied: boolean;
  tokenSource: "app" | "vault" | "env";
  workflowId: "kody.yml";
  ref: string;
}

function parseIssueNumber(taskId: string): number | null {
  const issueNumber = Number.parseInt(taskId.replace("issue-", ""), 10);
  return Number.isFinite(issueNumber) ? issueNumber : null;
}

async function resolveAutomationOctokit(): Promise<{
  octokit: Octokit;
  source: StartTaskResult["tokenSource"];
}> {
  const background = await resolveBackgroundToken(getOwner(), getRepo());
  if (background) {
    return {
      octokit: createUserOctokit(background.token),
      source: background.source,
    };
  }

  return { octokit: getOctokit(), source: "env" };
}

async function applyBacklogLabelBestEffort(
  issueNumber: number,
  octokit: Octokit,
): Promise<boolean> {
  try {
    await ensureLabel(
      KODY_BACKLOG_LABEL,
      {
        color: "38bdf8",
        description: `Tasks attached to ${KODY_BACKLOG_LABEL}`,
      },
      octokit,
    );
    await addLabels(issueNumber, [KODY_BACKLOG_LABEL], octokit);
    return true;
  } catch (error) {
    console.warn(
      "[Kody] Could not apply backlog label while starting task:",
      error,
    );
    return false;
  }
}

export async function startKodyTask(
  taskId: string,
  _actor?: string,
): Promise<StartTaskResult> {
  const issueNumber = parseIssueNumber(taskId);
  if (issueNumber === null) {
    throw new Error("Invalid task ID");
  }

  const automation = await resolveAutomationOctokit();
  const backlogLabelApplied = await applyBacklogLabelBestEffort(
    issueNumber,
    automation.octokit,
  );

  const repo = await automation.octokit.rest.repos.get({
    owner: getOwner(),
    repo: getRepo(),
  });
  const ref = repo.data.default_branch || "main";
  const inputs = await buildKodyWorkflowDispatchInputs(automation.octokit, {
    owner: getOwner(),
    repo: getRepo(),
    ref,
    action: "run",
    issueNumber,
    storeRepoUrl: getStoreRepoUrl(),
    storeRef: getStoreRef(),
  });

  await automation.octokit.rest.actions.createWorkflowDispatch({
    owner: getOwner(),
    repo: getRepo(),
    workflow_id: "kody.yml",
    ref,
    inputs,
  });
  invalidateTaskCache();

  return {
    success: true,
    message: "Kody execution triggered",
    issueNumber,
    workflowDispatched: true,
    backlogLabelApplied,
    tokenSource: automation.source,
    workflowId: "kody.yml",
    ref,
  };
}
