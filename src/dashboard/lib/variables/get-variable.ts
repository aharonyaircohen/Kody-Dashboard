/**
 * @fileType utility
 * @domain variables
 * @pattern variable-resolver
 * @ai-summary High-level helper for runtime code that needs a non-secret
 *   config value. Reads state-repo `variables.json` first; falls
 *   through to process.env so existing env-based deploys keep working
 *   while we migrate config off env vars.
 */

import type { NextRequest } from "next/server";
import { getRequestAuth } from "@dashboard/lib/auth";
import { createUserOctokit } from "@dashboard/lib/github-client";
import { logger } from "@dashboard/lib/logger";
import { readVariables } from "./store";

interface GetVariableOptions {
  req: NextRequest;
  /** When true, skip the process.env fallback. Default false. */
  variablesOnly?: boolean;
}

export async function getVariable(
  name: string,
  options: GetVariableOptions,
): Promise<string | null> {
  const auth = getRequestAuth(options.req);
  if (auth) {
    try {
      const octokit = createUserOctokit(auth.token);
      const { doc } = await readVariables(octokit, auth.owner, auth.repo);
      const entry = doc.variables[name];
      if (entry?.value) return entry.value;
    } catch (err) {
      logger.warn(
        { err, name, owner: auth.owner, repo: auth.repo },
        "variables: read failed; falling back to env",
      );
    }
  }

  if (options.variablesOnly) return null;
  return process.env[name] ?? null;
}
