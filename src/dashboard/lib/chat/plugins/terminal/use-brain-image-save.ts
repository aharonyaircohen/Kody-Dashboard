/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern plugin-hook
 * @ai-summary Brain image save action + status (terminal toolbar). Lives in
 *   the plugin (Brain coupling stays inside the terminal plugin — plan M2)
 *   but is CALLED unconditionally from KodyChat so the busy/status state
 *   survives leaving terminal mode while a save is still polling. Split out
 *   of TerminalControls.tsx (Step 7 bundle check): hooks cannot be lazy, so
 *   this file is the only TerminalControls half that ships statically —
 *   the toolbar components load via React.lazy in terminal mode only.
 */
"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { authHeaders } from "../../core/kody-chat-live-session";

const BRAIN_IMAGE_SAVE_POLL_INTERVAL_MS = 10_000;
const BRAIN_IMAGE_SAVE_MAX_POLLS = 720; // 2 hours at 10 seconds.

interface BrainImageSaveStatus {
  phase?: string;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
}

export function useBrainImageSave() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<BrainImageSaveStatus | null>(null);

  const save = useCallback(async () => {
    setBusy(true);
    setStatus({
      phase: "starting",
      message: "Starting Brain image save",
      startedAt: new Date().toISOString(),
    });
    try {
      const res = await fetch("/api/kody/brain/image", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        phase?: string;
        jobId?: string;
        imageRef?: string;
        startedAt?: string;
        updatedAt?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      if (body.status === "completed" && body.imageRef) {
        setStatus({
          phase: body.phase ?? "completed",
          message: body.message ?? "Brain image saved",
          startedAt: body.startedAt,
          updatedAt: body.updatedAt,
        });
        toast.success("Brain image saved");
        return;
      }
      if (body.status !== "running" || !body.jobId) {
        throw new Error(body.message ?? body.error ?? "Save did not start");
      }

      toast.success("Brain image save started");
      setStatus({
        phase: body.phase ?? "starting",
        message: body.message ?? "Starting Brain image save",
        startedAt: body.startedAt,
        updatedAt: body.updatedAt,
      });
      for (let attempt = 0; attempt < BRAIN_IMAGE_SAVE_MAX_POLLS; attempt++) {
        await new Promise((resolve) =>
          setTimeout(resolve, BRAIN_IMAGE_SAVE_POLL_INTERVAL_MS),
        );
        const poll = await fetch(
          `/api/kody/brain/image?jobId=${encodeURIComponent(body.jobId)}`,
          { headers: authHeaders() },
        );
        const pollStatus = (await poll.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          phase?: string;
          imageRef?: string;
          startedAt?: string;
          updatedAt?: string;
          message?: string;
          error?: string;
        };
        if (poll.ok && pollStatus.status === "running") {
          setStatus({
            phase: pollStatus.phase ?? "starting",
            message: pollStatus.message ?? "Saving Brain image",
            startedAt: pollStatus.startedAt ?? body.startedAt,
            updatedAt: pollStatus.updatedAt,
          });
        }
        if (
          poll.ok &&
          pollStatus.status === "completed" &&
          pollStatus.imageRef
        ) {
          setStatus({
            phase: pollStatus.phase ?? "completed",
            message: pollStatus.message ?? "Brain image saved",
            startedAt: pollStatus.startedAt ?? body.startedAt,
            updatedAt: pollStatus.updatedAt,
          });
          toast.success("Brain image saved");
          return;
        }
        if (
          !poll.ok ||
          pollStatus.status === "failed" ||
          pollStatus.ok === false
        ) {
          throw new Error(
            pollStatus.message ??
              pollStatus.error ??
              `Save failed (HTTP ${poll.status})`,
          );
        }
      }
      throw new Error("Brain image save is still running after 2 hours");
    } catch (err) {
      setStatus({
        phase: "failed",
        message:
          err instanceof Error ? err.message : "Failed to save Brain image",
      });
      toast.error(
        err instanceof Error ? err.message : "Failed to save Brain image",
      );
    } finally {
      setBusy(false);
      window.setTimeout(() => setStatus(null), 4000);
    }
  }, []);

  const label =
    status?.message ?? (busy ? "Saving Brain image" : "Save Brain image");

  return { busy, label, save };
}
