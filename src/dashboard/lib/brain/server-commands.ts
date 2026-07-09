/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-server-commands
 *
 * Command boundary for Brain server lifecycle operations. Routes provide
 * authenticated context; this layer decides which Brain app/machine to mutate.
 */
import "server-only";

import {
  destroyServerBrain,
  isServerBrainProvisionTransientError,
  provisionServerBrain,
  resumeServerBrain,
  suspendServerBrain,
  updateServerBrainSuspension,
  type ServerBrainPerfTier,
  type ProvisionServerBrainResult,
} from "@dashboard/lib/infrastructure/server-brain";
import type { ServerProviderContext } from "@dashboard/lib/infrastructure/server-context";

import { resolveBrainService } from "./service-resolver";
import { clearBrainApp, readBrainApp, writeBrainApp } from "./store";
import { resolveBrainTarget } from "./target";

export type BrainServerCommand =
  | "provision"
  | "resume"
  | "suspend"
  | "destroy"
  | "update-suspension";

export interface ManageBrainServerInput {
  command: BrainServerCommand;
  context: ServerProviderContext;
  dashboardUrl?: string;
  appNameOverride?: string;
  perfTier?: ServerBrainPerfTier;
  suspendOnIdle?: boolean;
}

export class BrainCommandError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "brain_command_failed",
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function requireFlyToken(context: ServerProviderContext): string {
  if (!context.flyToken) {
    throw new BrainCommandError(
      "Fly token missing - add FLY_API_TOKEN to the repo Secrets vault.",
      400,
      "fly_token_missing",
    );
  }
  return context.flyToken;
}

async function resolveCurrentBrain(context: ServerProviderContext) {
  return resolveBrainService({
    flyToken: requireFlyToken(context),
    account: context.account,
    githubToken: context.githubToken,
    orgSlug: context.flyOrgSlug,
    defaultRegion: context.flyDefaultRegion,
  });
}

export function manageBrainServer(
  input: ManageBrainServerInput & { command: "provision" },
): Promise<ProvisionServerBrainResult>;
export function manageBrainServer(
  input: ManageBrainServerInput & {
    command: "resume" | "suspend" | "destroy";
  },
): Promise<{ ok: true }>;
export function manageBrainServer(
  input: ManageBrainServerInput & { command: "update-suspension" },
): Promise<{ ok: true; suspendOnIdle: boolean }>;
export async function manageBrainServer(input: ManageBrainServerInput) {
  const { context } = input;
  const flyToken = requireFlyToken(context);

  if (input.command === "provision") {
    const stored = await readBrainApp(
      context.account,
      context.githubToken,
    ).catch(() => null);
    const target = resolveBrainTarget({
      account: context.account,
      contextOrgSlug: context.flyOrgSlug,
      stored,
      appNameOverride: input.appNameOverride,
    });
    try {
      const result = await provisionServerBrain({
        providerToken: flyToken,
        account: context.account,
        model: context.engineModel,
        modelConfig: context.engineModelConfig,
        githubToken: context.githubToken,
        allSecrets: context.allSecrets,
        perfTier: input.perfTier ?? context.perfTier,
        orgSlug: target.orgSlug,
        defaultRegion: context.flyDefaultRegion,
        suspendOnIdle: input.suspendOnIdle,
        dashboardUrl: input.dashboardUrl,
        appNameOverride: target.app,
      });
      await writeBrainApp(context.account, context.githubToken, {
        version: 1,
        appName: result.app,
        orgSlug: result.org,
        createdAt: new Date().toISOString(),
      });
      return result;
    } catch (err) {
      if (isServerBrainProvisionTransientError(err)) {
        const retryable = err as Error & { retryAfterSeconds?: number };
        throw new BrainCommandError(
          retryable.message,
          503,
          "brain_provision_retryable",
          retryable.retryAfterSeconds,
        );
      }
      throw err;
    }
  }

  const brain = await resolveCurrentBrain(context);

  if (input.command === "resume") {
    await resumeServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
      ...(brain.machineId ? { machineIdOverride: brain.machineId } : {}),
    });
    return { ok: true };
  }

  if (input.command === "suspend") {
    await suspendServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
      ...(brain.machineId ? { machineIdOverride: brain.machineId } : {}),
    });
    return { ok: true };
  }

  if (input.command === "destroy") {
    await destroyServerBrain({
      providerToken: brain.flyToken,
      account: context.account,
      orgSlug: brain.orgSlug,
      defaultRegion: context.flyDefaultRegion,
      appNameOverride: brain.app,
    });
    await clearBrainApp(context.account, context.githubToken);
    return { ok: true };
  }

  if (input.command === "update-suspension") {
    if (input.suspendOnIdle === undefined) {
      throw new BrainCommandError(
        "Brain suspension must be 'auto' or 'never'.",
        400,
        "invalid_brain_suspension",
      );
    }
    if (brain.state === "off" || !brain.machineId) {
      throw new BrainCommandError(
        "Brain is not on yet. Turn it on before changing suspension.",
        409,
        "brain_not_running",
      );
    }
    return {
      ok: true,
      ...(await updateServerBrainSuspension({
        providerToken: brain.flyToken,
        account: context.account,
        orgSlug: brain.orgSlug,
        defaultRegion: context.flyDefaultRegion,
        appNameOverride: brain.app,
        machineIdOverride: brain.machineId,
        suspendOnIdle: input.suspendOnIdle,
      })),
    };
  }

  throw new BrainCommandError("Unsupported Brain command.", 400);
}
