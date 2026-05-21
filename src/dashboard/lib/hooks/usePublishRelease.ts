/**
 * @fileType hook
 * @domain kody
 * @pattern publish-release
 * @ai-summary Creates a release-request issue and triggers `@kody release`.
 *   Extracted from PublishButton so both the (mobile/Vibe) trigger button and
 *   the desktop header overflow menu drive the same flow without duplication.
 *   Intentionally NOT re-exported from hooks/index.ts — it imports
 *   `useCreateTask` from there, so keeping the edge one-way avoids a cycle.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";

import { kodyApi } from "../api";
import { useCreateTask } from "./index";

interface UsePublishReleaseOptions {
  actorLogin?: string;
  onPublished?: (issueNumber: number) => void;
}

export function usePublishRelease({
  actorLogin,
  onPublished,
}: UsePublishReleaseOptions) {
  const [pending, setPending] = useState(false);
  const createTask = useCreateTask();

  async function publish() {
    if (pending) return;
    setPending(true);
    const toastId = toast.loading("Creating release task…");
    try {
      const today = new Date().toISOString().slice(0, 10);
      // Step 1: create the issue WITHOUT auto-triggering @kody — bare @kody
      // routes to `classify`/`fix`, but we want the `release` orchestrator.
      // The /api/kody/tasks POST returns { success, issue: { number, ... } }
      // even though tasksApi.create is typed as Promise<KodyTask>. Read the
      // raw shape defensively in case the typing ever gets fixed.
      const raw = (await createTask.mutateAsync({
        title: `Release: ${today}`,
        body:
          `## Release request\n\n` +
          `Triggered from the dashboard by @${actorLogin ?? "unknown"} on ${today}.\n\n` +
          `The release orchestrator will drive: prepare → merge PR → publish → deploy.`,
        mode: "release",
        labels: ["release"],
        autoTrigger: false,
        actorLogin,
      })) as unknown as {
        issue?: { number?: number };
        issueNumber?: number;
      };

      const issueNumber = raw.issue?.number ?? raw.issueNumber;
      if (typeof issueNumber !== "number" || Number.isNaN(issueNumber)) {
        throw new Error("Server did not return an issue number");
      }

      toast.loading("Triggering @kody release…", { id: toastId });

      // Step 2: post the explicit `@kody release` trigger. See kody2/src/
      // dispatch.ts (extractAfterTag → first token) and src/executables/
      // release/profile.json — the orchestrator picks up the issue number
      // from the comment context.
      await kodyApi.tasks.comment(issueNumber, "@kody release", actorLogin);

      toast.success(`Release task #${issueNumber} created and triggered`, {
        id: toastId,
      });
      onPublished?.(issueNumber);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to publish";
      console.error("[usePublishRelease] publish failed", err);
      toast.error(`Publish failed: ${message}`, { id: toastId });
    } finally {
      setPending(false);
    }
  }

  return { publish, pending };
}
