/**
 * @fileType use-case
 * @domain brain
 * @pattern brain-overview-query
 *
 * Single Brain read model for status/UI routes. It composes live Brain server
 * state, persisted runtime state, and image drift warnings without mutating
 * infrastructure.
 */
import "server-only";

import { readBrainRuntimeAuthority } from "./runtime-authority";

export interface ReadBrainOverviewInput {
  flyToken?: string | null;
  account: string;
  githubToken: string;
  orgSlug: string;
  defaultRegion: string;
  allowServiceFailure?: boolean;
}

export async function readBrainOverview(input: ReadBrainOverviewInput) {
  if (!input.flyToken) {
    return {
      app: undefined,
      state: "off" as const,
      stored: null,
      runtime: null,
      drift: null,
      service: null,
    };
  }

  const authority = await readBrainRuntimeAuthority({
    flyToken: input.flyToken,
    account: input.account,
    githubToken: input.githubToken,
    orgSlug: input.orgSlug,
    defaultRegion: input.defaultRegion,
    allowServiceFailure: input.allowServiceFailure,
  });
  const service = authority.service;
  return {
    app: service?.app,
    state: service?.state ?? ("off" as const),
    url: service?.url,
    machineId: service?.machineId,
    machineImageRef: service?.machineImageRef,
    org: service?.orgSlug,
    reason: service?.reason,
    stored: service?.stored ?? null,
    runtime: authority.runtime,
    drift: authority.drift,
    service,
  };
}
