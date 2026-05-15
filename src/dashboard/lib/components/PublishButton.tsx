/**
 * @fileType component
 * @domain kody
 * @pattern publish-release
 * @ai-summary Header button that creates a release-request issue and triggers `@kody release`.
 */
"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { ConfirmDialog } from "./ConfirmDialog";
import { SimpleTooltip } from "./SimpleTooltip";
import { useCreateTask } from "../hooks";
import { kodyApi } from "../api";

interface PublishButtonProps {
  actorLogin?: string;
  onPublished?: (issueNumber: number) => void;
  /** Optional override for the trigger Button's className (used by the mobile menu). */
  triggerClassName?: string;
}

export function PublishButton({ actorLogin, onPublished, triggerClassName }: PublishButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
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
      console.error("[PublishButton] publish failed", err);
      toast.error(`Publish failed: ${message}`, { id: toastId });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SimpleTooltip content="Publish a release" side="bottom">
        <Button
          variant="outline"
          size={triggerClassName ? undefined : "sm"}
          onClick={() => setShowConfirm(true)}
          disabled={pending}
          aria-label="Publish a release"
          className={triggerClassName ?? "gap-1"}
        >
          <Rocket className={`w-4 h-4 ${pending ? "animate-pulse" : ""}`} />
        </Button>
      </SimpleTooltip>

      <ConfirmDialog
        open={showConfirm}
        title="Publish a release?"
        description="This creates a release-request task and triggers @kody release. The orchestrator runs prepare → merge PR → publish → deploy."
        confirmLabel="Publish"
        variant="default"
        onConfirm={publish}
        onClose={() => setShowConfirm(false)}
      />
    </>
  );
}
