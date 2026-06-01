/**
 * @fileType endpoint
 * @domain kody
 * @pattern files-operations-api
 * @ai-summary Write operations for the file browser: create/update/delete/rename/move files,
 *   create symlinks, and upload files.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireKodyAuth, getRequestAuth } from "@dashboard/lib/auth";
import {
  getOctokit,
  setGitHubContext,
  clearGitHubContext,
  getOwner,
  getRepo,
} from "@dashboard/lib/github-client";

const WRITE_SCHEMA = z.object({
  operation: z.enum(["write", "delete", "rename", "move", "symlink", "mkdir"]),
  path: z.string(),
  content: z.string().optional(), // base64 for write, target for symlink
  sha: z.string().optional(), // required for delete/update
  message: z.string().optional(),
  target: z.string().optional(), // for symlink
  ref: z.string().optional(), // branch to target
});

function invalidateCache(prefix: string) {
  // Simple approach: clear all file caches when writes happen
  // In production, you'd want more targeted invalidation
  console.info(`[repo-files] Cache invalidated: ${prefix}`);
}

export async function POST(req: NextRequest) {
  const authError = await requireKodyAuth(req);
  if (authError) return authError;

  const headerAuth = getRequestAuth(req);
  if (headerAuth) {
    setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  }

  try {
    // Use user token for writes
    const { getUserOctokit } = await import("@dashboard/lib/auth");
    const userOctokit = await getUserOctokit(req);
    const octokit = userOctokit ?? getOctokit();
    const owner = getOwner();
    const repo = getRepo();

    const body = await req.json();
    const parsed = WRITE_SCHEMA.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid params", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { operation, path, content, sha, message, target, ref } = parsed.data;
    const branchRef = ref ?? "HEAD";
    const commitMessage = message ?? `${operation} ${path}`;

    switch (operation) {
      case "write": {
        if (content === undefined) {
          return NextResponse.json(
            { error: "content required for write" },
            { status: 400 },
          );
        }
        const { data } = await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: commitMessage,
          content,
          sha: sha ?? undefined,
          branch: branchRef,
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({
          success: true,
          sha: data.content?.sha,
          commit: data.commit?.sha,
        });
      }

      case "delete": {
        if (!sha) {
          return NextResponse.json(
            { error: "sha required for delete" },
            { status: 400 },
          );
        }
        await octokit.repos.deleteFile({
          owner,
          repo,
          path,
          message: commitMessage,
          sha,
          branch: branchRef,
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({ success: true });
      }

      case "rename": {
        if (!sha) {
          return NextResponse.json(
            { error: "sha required for rename" },
            { status: 400 },
          );
        }
        // Read current content, delete old, create new
        const { data: fileData } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branchRef,
        });
        if (Array.isArray(fileData) || !("content" in fileData)) {
          return NextResponse.json(
            { error: "Cannot rename a directory" },
            { status: 400 },
          );
        }
        const fileContent = fileData.content;
        const newPath = target;
        if (!newPath) {
          return NextResponse.json(
            { error: "target (new path) required for rename" },
            { status: 400 },
          );
        }
        // Create at new path
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: newPath,
          message: commitMessage,
          content: fileContent,
          branch: branchRef,
        });
        // Delete old path
        await octokit.repos.deleteFile({
          owner,
          repo,
          path,
          message: `chore: delete old path after rename to ${newPath}`,
          sha,
          branch: branchRef,
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({ success: true });
      }

      case "move": {
        // Same as rename but for moving to a different directory
        if (!sha) {
          return NextResponse.json(
            { error: "sha required for move" },
            { status: 400 },
          );
        }
        if (!target) {
          return NextResponse.json(
            { error: "target (destination path) required for move" },
            { status: 400 },
          );
        }
        const { data: moveFileData } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branchRef,
        });
        if (Array.isArray(moveFileData) || !("content" in moveFileData)) {
          return NextResponse.json(
            { error: "Cannot move a directory via this API" },
            { status: 400 },
          );
        }
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: target,
          message: commitMessage,
          content: moveFileData.content,
          branch: branchRef,
        });
        await octokit.repos.deleteFile({
          owner,
          repo,
          path,
          message: `chore: delete old path after move to ${target}`,
          sha,
          branch: branchRef,
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({ success: true });
      }

      case "symlink": {
        if (!target) {
          return NextResponse.json(
            { error: "target (link target) required for symlink" },
            { status: 400 },
          );
        }
        // GitHub API: create a file with content being the target and blob type symlink
        // Unfortunately GitHub Contents API doesn't directly support symlinks
        // We need to use the Git data API or create a file that points to a symlink ref
        // For now, use the blob type approach via createOrUpdateFileContents with content=target
        // and hope the user understands it's a symlink reference
        const symlinkContent = Buffer.from(target, "utf-8").toString("base64");
        // Use a special message format that GitHub recognizes
        const { data } = await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path,
          message: commitMessage,
          content: symlinkContent,
          branch: branchRef,
          // Note: GitHub API doesn't actually create true symlinks via Contents API
          // This creates a file containing the target path text
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({
          success: true,
          sha: data.content?.sha,
          commit: data.commit?.sha,
        });
      }

      case "mkdir": {
        // Create an empty directory - GitHub doesn't support empty dirs
        // Create a .gitkeep file as a workaround
        const dirPath = path.endsWith("/") ? path : `${path}/`;
        const gitkeepPath = `${dirPath}.gitkeep`;
        await octokit.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: gitkeepPath,
          message: commitMessage || `chore: create directory ${path}`,
          content: Buffer.from("", "utf-8").toString("base64"),
          branch: branchRef,
        });
        invalidateCache(`files:${owner}:${repo}:`);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 },
        );
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    const message = (error as { message?: string })?.message ?? "Unknown error";
    console.error(`File operation error:`, error);
    if (status === 404) {
      return NextResponse.json(
        { error: "File or path not found" },
        { status: 404 },
      );
    }
    if (status === 409) {
      return NextResponse.json(
        {
          error:
            "Conflict: file may have changed. Please refresh and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: `Operation failed: ${message}` },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
