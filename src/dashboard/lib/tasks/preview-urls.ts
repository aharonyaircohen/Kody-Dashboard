/**
 * @fileType library
 * @domain tasks
 * @pattern preview-url-resolution
 * @ai-summary Resolves task preview URLs without fabricating Fly hosts before previews exist.
 */

import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import { getPreview } from "@dashboard/lib/previews/preview-lifecycle";
import type { GitHubPR } from "@dashboard/lib/types";

type PreviewPr = Pick<GitHubPR, "number" | "head">;

export interface BuildPreviewUrlByPrNumberInput {
  openPRs: PreviewPr[];
  deploymentPreviewUrls: Map<string, string>;
  flyPreviewConfig: FlyPreviewConfig | null;
  repo: string;
}

async function getReadyFlyPreviewUrl(
  repo: string,
  pr: number,
  cfg: FlyPreviewConfig,
): Promise<string | null> {
  try {
    const preview = await getPreview({ repo, pr }, cfg);
    return preview?.url ?? null;
  } catch {
    return null;
  }
}

export async function buildPreviewUrlByPrNumber({
  openPRs,
  deploymentPreviewUrls,
  flyPreviewConfig,
  repo,
}: BuildPreviewUrlByPrNumberInput): Promise<Map<number, string>> {
  const entries = await Promise.all(
    openPRs.map(async (pr): Promise<[number, string] | null> => {
      if (flyPreviewConfig) {
        const flyUrl = await getReadyFlyPreviewUrl(
          repo,
          pr.number,
          flyPreviewConfig,
        );
        if (flyUrl) return [pr.number, flyUrl];
      }

      const deploymentUrl = deploymentPreviewUrls.get(pr.head.sha);
      return deploymentUrl ? [pr.number, deploymentUrl] : null;
    }),
  );

  return new Map(entries.filter((entry): entry is [number, string] => !!entry));
}
