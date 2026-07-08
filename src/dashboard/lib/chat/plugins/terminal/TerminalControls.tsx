/**
 * @fileType component
 * @domain chat-plugin-terminal
 * @pattern host-slot-nodes
 * @ai-summary Terminal chrome moved out of KodyChat in Step 5a: the AI ⇄
 *   Terminal mode toggle, the terminal top toolbar (target picker + Brain
 *   image actions + Fly refresh), the bottom action row, and the Brain
 *   image save hook. These stay HOST-PASSED ReactNodes (not registry slot
 *   contributions) on purpose: the ChatPluginSlot mount wraps contributions
 *   in a `display: contents` div, which would change the DOM the admin
 *   regression suite pins — passing elements keeps the DOM byte-identical.
 *   NOTE: imports RepoScopedLink from components/ — an app-wide shared
 *   component, allowed by the lint zones (plugins are only barred from
 *   sibling plugins).
 */
"use client";

import { useCallback, useState } from "react";
import {
  ClipboardCopy,
  Eraser,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Save,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";

import { RepoScopedLink } from "../../../components/RepoScopedLink";
import {
  flyMachineTerminalLabel,
  flyTerminalTargetLabel,
  type FlyMachineRow,
} from "../../../runners/fly-machine-model";
import { authHeaders } from "../../core/kody-chat-live-session";
import {
  terminalFlyMachineKey,
  terminalMachineIdShort,
} from "./registry-state";
import type {
  ChatTerminalConnectionState,
  ChatTerminalMode,
  ChatTerminalTransport,
} from "./types";

const BRAIN_IMAGE_SAVE_POLL_INTERVAL_MS = 10_000;
const BRAIN_IMAGE_SAVE_MAX_POLLS = 720; // 2 hours at 10 seconds.

interface BrainImageSaveStatus {
  phase?: string;
  message?: string;
  startedAt?: string;
  updatedAt?: string;
}

/**
 * Brain image save action (terminal toolbar). Lives in the plugin (Brain
 * coupling stays inside the terminal plugin — plan M2) but is CALLED from
 * KodyChat so the busy/status state survives leaving terminal mode while a
 * save is still polling.
 */
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
        if (poll.ok && pollStatus.status === "completed" && pollStatus.imageRef) {
          setStatus({
            phase: pollStatus.phase ?? "completed",
            message: pollStatus.message ?? "Brain image saved",
            startedAt: pollStatus.startedAt ?? body.startedAt,
            updatedAt: pollStatus.updatedAt,
          });
          toast.success("Brain image saved");
          return;
        }
        if (!poll.ok || pollStatus.status === "failed" || pollStatus.ok === false) {
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

export function TerminalModeToggle({
  chatMode,
  terminalStatusLabel,
  hasLiveTerminal,
  connectionState,
  onSelectAiMode,
  onOpenTerminal,
}: {
  chatMode: ChatTerminalMode;
  terminalStatusLabel: string;
  hasLiveTerminal: boolean;
  connectionState: ChatTerminalConnectionState;
  onSelectAiMode: () => void;
  onOpenTerminal: () => void;
}) {
  return (
    <div
      className={`inline-flex items-center rounded-md border p-0.5 ${
        chatMode === "terminal"
          ? "justify-self-end border-white/10 bg-white/5"
          : "bg-background/70"
      }`}
    >
      <button
        type="button"
        onClick={onSelectAiMode}
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-body-xs font-medium transition-colors ${
          chatMode === "ai"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-pressed={chatMode === "ai"}
        title="AI chat"
        aria-label="AI chat"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onOpenTerminal}
        className={`relative inline-flex h-8 w-8 items-center justify-center rounded text-body-xs font-medium transition-colors ${
          chatMode === "terminal"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        aria-pressed={chatMode === "terminal"}
        title={`Terminal ${terminalStatusLabel}`}
        aria-label={`Terminal ${terminalStatusLabel}`}
      >
        <SquareTerminal className="h-4 w-4" aria-hidden="true" />
        {hasLiveTerminal &&
          chatMode === "ai" &&
          connectionState === "connected" && (
            <span
              className="absolute end-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
          )}
      </button>
    </div>
  );
}

export function TerminalTopControls({
  activeTargetValue,
  onSelectTarget,
  activeTransport,
  terminalMachines,
  flyInventoryError,
  flyInventoryLoading,
  onRefreshMachines,
  brainImageBusy,
  brainImageSaveLabel,
  onSaveBrainImage,
}: {
  activeTargetValue: string;
  onSelectTarget: (value: string) => void;
  activeTransport: ChatTerminalTransport;
  terminalMachines: FlyMachineRow[];
  flyInventoryError: string | null;
  flyInventoryLoading: boolean;
  onRefreshMachines: () => void;
  brainImageBusy: boolean;
  brainImageSaveLabel: string;
  onSaveBrainImage: () => void;
}) {
  return (
    <div
      data-testid="chat-terminal-toolbar"
      className="flex w-full min-w-0 items-center gap-2"
    >
      <div
        data-testid="chat-terminal-target-row"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <select
          value={activeTargetValue}
          onChange={(event) => onSelectTarget(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-body-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          title="Terminal target"
          aria-label="Terminal target"
        >
          <option value="local">Local terminal</option>
          {(activeTransport.type === "brain" ||
            terminalMachines.some(
              (machine) => machine.feature === "brain",
            )) && <option value="brain">Brain terminal</option>}
          {activeTransport.type === "fly" &&
            !terminalMachines.some(
              (machine) =>
                terminalFlyMachineKey(machine) === activeTargetValue,
            ) && (
              <option value={activeTargetValue}>
                {flyTerminalTargetLabel(activeTransport)} · selected
              </option>
            )}
          {terminalMachines
            .filter((machine) => machine.feature !== "brain")
            .map((machine) => (
              <option
                key={terminalFlyMachineKey(machine)}
                value={terminalFlyMachineKey(machine)}
              >
                {flyMachineTerminalLabel(machine)} · {machine.state} ·{" "}
                {machine.region} · {terminalMachineIdShort(machine.machineId)}
              </option>
            ))}
        </select>
        {flyInventoryError && (
          <span className="max-w-48 min-w-0 truncate text-body-xs text-destructive">
            {flyInventoryError}
          </span>
        )}
      </div>
      <div
        data-testid="chat-terminal-actions-row"
        className="flex shrink-0 items-center gap-1"
      >
        <RepoScopedLink
          href="/fly/brain-images"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Manage Brain images"
          aria-label="Manage Brain images"
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </RepoScopedLink>
        <button
          type="button"
          onClick={onSaveBrainImage}
          disabled={brainImageBusy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title={brainImageSaveLabel}
          aria-label={brainImageSaveLabel}
        >
          {brainImageBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
        </button>
        {brainImageBusy && (
          <span className="hidden max-w-40 truncate text-[11px] text-amber-100/80 lg:inline">
            {brainImageSaveLabel}
          </span>
        )}
        <button
          type="button"
          onClick={onRefreshMachines}
          disabled={flyInventoryLoading}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Refresh Fly machines"
          aria-label="Refresh Fly machines"
        >
          {flyInventoryLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function TerminalBottomControls({
  onAddToChat,
  onRestart,
  onClear,
  actionBusy,
}: {
  onAddToChat: () => void;
  onRestart: () => void;
  onClear: () => void;
  actionBusy: boolean | undefined;
}) {
  return (
    <div
      data-testid="chat-terminal-bottom-status"
      className="flex min-w-0 shrink items-center gap-2"
    >
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onAddToChat}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Add terminal output to AI chat"
          aria-label="Add terminal output to AI chat"
        >
          <ClipboardCopy className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRestart}
          disabled={actionBusy}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          title="Restart terminal"
          aria-label="Restart terminal"
        >
          {actionBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Clear terminal"
          aria-label="Clear terminal"
        >
          <Eraser className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
