/**
 * @fileType utility
 * @domain runners
 * @pattern server-provider-run
 * @ai-summary Provider-neutral helpers for starting Kody work on the installed
 *   server provider. Routes should use this instead of vendor helpers.
 */

import type { NextRequest } from "next/server";
import { getServerProvider } from "@dashboard/lib/infrastructure/installed";
import type { ServerContextBase } from "@dashboard/lib/infrastructure/contracts";
import type { KodyRunRequest } from "./run-request";

export interface ClaimOrRunServerOptions {
  /** Task id / job id for logs, pool claims, and machine identity. */
  taskId: string;
  runRequest: KodyRunRequest;
  idleExitMs?: number;
  hardCapMs?: number;
  /** Pre-signed ingest URL with inline HMAC token; undefined -> git-polling. */
  dashboardUrl?: string;
  /**
   * Thinking level (off|low|medium|high). Forwarded to providers that support
   * it. Empty/undefined means the engine uses its own default.
   */
  reasoningEffort?: string;
  /** Git ref to clone. */
  ref?: string;
}

export interface ClaimOrRunServerResult {
  runner: "pool" | "fly";
  machineId: string;
}

export interface ResolveServerContextOptions {
  repoOverride?: { owner: string; repo: string };
}

export async function resolveServerContext(
  req: NextRequest,
  options?: ResolveServerContextOptions,
) {
  const provider = getServerProvider();
  if (!provider.resolveContext) {
    return {
      ok: false as const,
      error: "Installed server provider cannot resolve context",
      status: 501,
    };
  }
  return provider.resolveContext({ request: req, options });
}

export function isServerProviderAvailable(context: ServerContextBase): boolean {
  return getServerProvider().isAvailable?.(context) ?? true;
}

export async function claimOrRunServer(
  context: ServerContextBase,
  opts: ClaimOrRunServerOptions,
): Promise<ClaimOrRunServerResult> {
  const provider = getServerProvider();
  if (!provider.claimOrRun) {
    throw new Error("Installed server provider cannot claim or run work");
  }
  return provider.claimOrRun(context, opts) as Promise<ClaimOrRunServerResult>;
}
