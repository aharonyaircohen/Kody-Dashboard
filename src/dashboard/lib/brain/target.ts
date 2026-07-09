/**
 * @fileType utility
 * @domain brain
 * @pattern brain-target-resolution
 *
 * Resolves the Fly app name and org as one unit. A stored Brain record owns
 * both values; callers should not use the stored app with a different org.
 */

import { type BrainAppFile } from "@dashboard/lib/brain/store";
import { slugifyTitle } from "@dashboard/lib/slug";

export type BrainTargetSource = "override" | "stored" | "default";

export interface BrainTarget {
  app: string;
  orgSlug: string;
  source: BrainTargetSource;
}

function defaultBrainAppName(account: string): string {
  return `kody-brain-${slugifyTitle(account, {
    fallback: "account",
    allowUnderscore: false,
  })}`;
}

export function resolveBrainTarget(input: {
  account: string;
  contextOrgSlug: string;
  stored: BrainAppFile | null;
  appNameOverride?: string;
}): BrainTarget {
  const override = input.appNameOverride?.trim();
  if (override) {
    return {
      app: override,
      orgSlug:
        input.stored?.appName === override
          ? input.stored.orgSlug
          : input.contextOrgSlug,
      source: "override",
    };
  }

  if (input.stored) {
    return {
      app: input.stored.appName,
      orgSlug: input.stored.orgSlug,
      source: "stored",
    };
  }

  return {
    app: defaultBrainAppName(input.account),
    orgSlug: input.contextOrgSlug,
    source: "default",
  };
}
