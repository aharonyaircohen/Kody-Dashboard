import { serverOperations } from "./server-operations";
import type { Octokit } from "@octokit/rest";
import type {
  ProviderActivityFile,
  ProviderActivitySnapshot,
  ProviderActivitySample,
  ProviderInventory,
} from "./server-operations";

export type ServerProviderActivitySample = ProviderActivitySample;
export type ServerProviderActivityFile = ProviderActivityFile;
export type ServerProviderActivitySnapshot = ProviderActivitySnapshot;

export function computeServerProviderActivity(file: ProviderActivityFile) {
  return serverOperations.provider().computeActivity(file);
}

export function readServerProviderActivityFile(
  octokit: Octokit,
  owner: string,
  repo: string,
) {
  return serverOperations.provider().readActivityFile(octokit, owner, repo);
}

export function recordServerProviderSnapshot(
  octokit: Octokit,
  owner: string,
  repo: string,
  snapshot: ProviderActivitySnapshot,
) {
  return serverOperations
    .provider()
    .recordSnapshot(octokit, owner, repo, snapshot);
}

export function snapshotFromServerProviderInventory(
  inventory: ProviderInventory,
  now: number,
) {
  return serverOperations.provider().snapshotFromInventory(inventory, now);
}

export function snapshotDue(
  file: { snapshots?: Array<{ ts: number }> },
  now: number,
): boolean {
  const snapshots = file.snapshots ?? [];
  const last = snapshots[snapshots.length - 1];
  return !last || now - last.ts >= 5 * 60_000;
}
