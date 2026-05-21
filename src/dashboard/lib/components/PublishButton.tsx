/**
 * @fileType component
 * @domain kody
 * @pattern publish-release
 * @ai-summary Header button that creates a release-request issue and triggers `@kody release`.
 */
"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { ConfirmDialog } from "./ConfirmDialog";
import { SimpleTooltip } from "./SimpleTooltip";
import { usePublishRelease } from "../hooks/usePublishRelease";

interface PublishButtonProps {
  actorLogin?: string;
  onPublished?: (issueNumber: number) => void;
  /** Optional override for the trigger Button's className (used by the mobile menu). */
  triggerClassName?: string;
}

export function PublishButton({
  actorLogin,
  onPublished,
  triggerClassName,
}: PublishButtonProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const { publish, pending } = usePublishRelease({ actorLogin, onPublished });

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
