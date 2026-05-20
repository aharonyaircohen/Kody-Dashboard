/**
 * @fileType utility
 * @domain kody
 * @pattern memory-sticky-note
 * @ai-summary Drop a verdict sticky note into the connected repo's
 *   `.kody/memory/inbox/`. The repo-side `memory-writer` job drains the
 *   inbox on its cadence and files each sticky note under
 *   `.kody/memory/<name>.md`. Verdict memory exists so CEO-style proposers
 *   (and any future job that scans for "what did the operator already
 *   decide?") can avoid re-proposing what was dismissed or rejected.
 *
 *   This helper deliberately does NOT touch `.kody/memory/<name>.md`
 *   directly — that path is owned by the memory-writer job, and writing
 *   it from two places would race. Sticky notes have unique filenames so
 *   parallel writers never collide.
 */
import type { Octokit } from "@octokit/rest";
import { getOwner, getRepo } from "../github-client";

export interface VerdictStickyInput {
  octokit: Octokit;
  taskNumber: number;
  action: string;
  decision: "approve" | "reject" | "dismiss";
  actorLogin?: string;
  command?: string | null;
}

const INBOX_DIR = ".kody/memory/inbox";

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function filenameTimestamp(ts: Date): string {
  return ts.toISOString().replace(/[:.]/g, "-");
}

function buildBody(
  taskNumber: number,
  action: string,
  decision: VerdictStickyInput["decision"],
  actorLogin: string | undefined,
  command: string | null | undefined,
): string {
  const lines: string[] = [
    `**Task:** #${taskNumber}`,
    `**Action:** ${action}`,
    `**Decision:** ${decision}`,
  ];
  if (actorLogin) lines.push(`**Actor:** @${actorLogin}`);
  if (command) lines.push(`**Command:** \`${command}\``);
  lines.push("");
  const tailByDecision: Record<VerdictStickyInput["decision"], string> = {
    dismiss:
      "The operator dismissed this recommendation. Drained from the inbox without trust impact. Future proposers should not surface the same recommendation again.",
    reject:
      "The operator rejected this recommendation. Resets the consecutive-approval streak for this action — treat this action mode as untrusted for now.",
    approve:
      "The operator approved this recommendation. The dispatchable command (if any) was posted to the task issue.",
  };
  lines.push(tailByDecision[decision]);
  return lines.join("\n");
}

export async function dropVerdictStickyNote(
  input: VerdictStickyInput,
): Promise<void> {
  const { octokit, taskNumber, action, decision, actorLogin, command } = input;
  const ts = new Date();
  const stamp = filenameTimestamp(ts);
  const filename = `${stamp}-dashboard-${decision}-${shortId()}.json`;
  const memoryName = `verdict-cto-${taskNumber}-${action}-${decision}`;

  const payload = {
    type: "verdict" as const,
    name: memoryName,
    title: `Verdict: ${decision} on CTO ${action} for #${taskNumber}`,
    hook: `Operator ${decision}ed the CTO ${action} recommendation on task #${taskNumber}${actorLogin ? ` (by @${actorLogin})` : ""}.`,
    body: buildBody(taskNumber, action, decision, actorLogin, command),
    source: `dashboard:cto:${decision}`,
    ts: ts.toISOString(),
    links: [],
  };

  await octokit.repos.createOrUpdateFileContents({
    owner: getOwner(),
    repo: getRepo(),
    path: `${INBOX_DIR}/${filename}`,
    message: `chore(memory): drop ${decision} verdict sticky for #${taskNumber}`,
    content: Buffer.from(JSON.stringify(payload, null, 2), "utf-8").toString(
      "base64",
    ),
  });
}
