/**
 * @fileType utility
 * @domain brain
 * @pattern brain-target-resolution
 *
 * @ai-summary Resolve Fly app name and org as one atomic unit. The
 *   precedence is `appNameOverride` → stored `BrainAppFile` → derived
 *   `brainAppName(account)` default. Trap: a stored Brain record owns
 *   BOTH its app name and its org — they were provisioned together and
 *   the app lives in that specific org. Callers must not pair a stored
 *   app name with a different org from context; when the override matches
 *   a stored app we keep the stored org (so admins moving tokens between
 *   orgs cannot accidentally split an app from its real home). When the
 *   override is genuinely new (or no stored record exists), the org
 *   falls back to `contextOrgSlug`. Always resolve through this function
 *   — never hand-roll the precedence inline.
 */

import { type BrainAppFile } from "@dashboard/lib/brain/store";
import { brainAppName } from "@dashboard/lib/runners/brain-fly";

export type BrainTargetSource = "override" | "stored" | "default";

export interface BrainTarget {
  app: string;
  orgSlug: string;
  source: BrainTargetSource;
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
    app: brainAppName(input.account),
    orgSlug: input.contextOrgSlug,
    source: "default",
  };
}
