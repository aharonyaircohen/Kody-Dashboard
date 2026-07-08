import type { NextRequest } from "next/server";

import { logger } from "@dashboard/lib/logger";
import {
  claimOrRunServer,
  resolveServerContext,
} from "@dashboard/lib/runners/server-run";
import type { KodyRunRequest } from "./run-request";

interface RepoMetadataOctokit {
  rest: {
    repos: {
      get(input: {
        owner: string;
        repo: string;
      }): Promise<{ data: { default_branch?: string | null } }>;
    };
  };
}

export type ScheduledKodyRunResult =
  | {
      ok: true;
      runner: "pool" | "fly";
      machineId: string;
      ref: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

export async function runScheduledKodyOnRunner(
  req: NextRequest,
  opts: {
    taskId: string;
    runRequest: KodyRunRequest;
  },
): Promise<ScheduledKodyRunResult> {
  const ctxResult = await resolveServerContext(req);
  if (!ctxResult.ok) {
    return {
      ok: false,
      error: ctxResult.error,
      status: ctxResult.status,
    };
  }

  const { owner, repo } = ctxResult.context;
  const octokit = ctxResult.context.octokit as RepoMetadataOctokit;
  let ref = "main";
  try {
    const repoMeta = await octokit.rest.repos.get({ owner, repo });
    ref = repoMeta.data.default_branch || "main";
  } catch (err) {
    logger.warn(
      { err, owner, repo },
      "kody-runner: default-branch lookup failed; runner will use main",
    );
  }

  try {
    const run = await claimOrRunServer(ctxResult.context, {
      taskId: opts.taskId,
      runRequest: opts.runRequest,
      ref,
    });
    return { ok: true, runner: run.runner, machineId: run.machineId, ref };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: 500,
    };
  }
}
