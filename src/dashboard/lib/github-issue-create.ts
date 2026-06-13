import type { Octokit } from "@octokit/rest";

interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface CreateIssueResult {
  data: Awaited<ReturnType<Octokit["rest"]["issues"]["create"]>>["data"];
  metadataWarnings: string[];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown GitHub error";
}

export async function createIssueWithBestEffortMetadata(
  octokit: Octokit,
  input: CreateIssueInput,
): Promise<CreateIssueResult> {
  const { owner, repo, title, body, labels, assignees } = input;
  const { data } = await octokit.rest.issues.create({
    owner,
    repo,
    title,
    body: body ?? "",
  });

  const metadataWarnings: string[] = [];

  if (labels && labels.length > 0) {
    try {
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: data.number,
        labels,
      });
    } catch (err) {
      metadataWarnings.push(`Labels not applied: ${messageOf(err)}`);
    }
  }

  if (assignees && assignees.length > 0) {
    try {
      await octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: data.number,
        assignees,
      });
    } catch (err) {
      metadataWarnings.push(`Assignees not applied: ${messageOf(err)}`);
    }
  }

  return { data, metadataWarnings };
}
