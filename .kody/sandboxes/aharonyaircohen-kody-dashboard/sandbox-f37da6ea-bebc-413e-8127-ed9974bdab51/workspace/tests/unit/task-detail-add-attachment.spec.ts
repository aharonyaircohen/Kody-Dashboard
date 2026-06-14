/**
 * Regression test: task details needs a standalone attachment action.
 *
 * Task details needs a direct "Add attachment" action in the side panel
 * that uploads files and posts repo paths to the GitHub issue for Kody.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ISSUE_ATTACHMENT_BUTTON_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/IssueAttachmentButton.tsx",
);
const TASK_DETAIL_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/components/TaskDetail.tsx",
);
const GITHUB_CLIENT_PATH = resolve(
  __dirname,
  "../../src/dashboard/lib/github-client.ts",
);

const readSource = (path: string) =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

const BUTTON_SOURCE = readSource(ISSUE_ATTACHMENT_BUTTON_PATH);
const TASK_DETAIL_SOURCE = readSource(TASK_DETAIL_PATH);
const GITHUB_CLIENT_SOURCE = readSource(GITHUB_CLIENT_PATH);

describe("Task detail — standalone attachment action", () => {
  it("returns the repo path from attachment upload", () => {
    expect(GITHUB_CLIENT_SOURCE).toMatch(
      /Promise<\{[\s\S]*url: string;[\s\S]*path: string;/,
    );
    expect(GITHUB_CLIENT_SOURCE).toMatch(/return \{[\s\S]*path,/);
  });

  it("uploads selected files and posts an @kody comment with repo paths", () => {
    expect(BUTTON_SOURCE).toMatch(/uploadCommentAttachmentFile/);
    expect(BUTTON_SOURCE).toMatch(/buildIssueAttachmentComment/);
    expect(BUTTON_SOURCE).toMatch(/Please read this file before acting/);
    expect(BUTTON_SOURCE).toMatch(/uploaded\.map\(\(a\) => a\.path\)/);
    expect(BUTTON_SOURCE).toMatch(
      /postComment\(buildIssueAttachmentComment\(paths\)\)/,
    );
  });

  it("uses a hidden multi-file input for the standalone attachment picker", () => {
    expect(BUTTON_SOURCE).toMatch(/attachmentInputRef/);
    expect(BUTTON_SOURCE).toMatch(/type="file"[\s\S]{0,120}multiple/);
    expect(BUTTON_SOURCE).toMatch(/onChange=\{handleAttachmentChange\}/);
  });

  it("does not show Add attachment in the Description tab content", () => {
    const descriptionPanel = TASK_DETAIL_SOURCE.match(
      /id="task-panel-description"[\s\S]*?\{effectiveTab === "comments"/,
    )?.[0];

    expect(descriptionPanel).toBeTruthy();
    expect(descriptionPanel).not.toMatch(/<IssueAttachmentButton/);
  });

  it("shows Add attachment under Labels in the side panel", () => {
    expect(TASK_DETAIL_SOURCE).toMatch(
      /Labels[\s\S]*<IssueAttachmentButton[\s\S]*issueNumber=\{task\.issueNumber\}/,
    );
  });
});
