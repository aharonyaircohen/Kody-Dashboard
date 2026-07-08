/**
 * @fileType component
 * @domain chat-plugin-terminal
 * @pattern host-slot-nodes
 * @ai-summary Terminal chrome moved out of KodyChat in Step 5a: the AI ⇄
 *   Terminal mode toggle, the terminal top toolbar (target picker + Brain
 *   image actions + Fly refresh), and the bottom action row. These stay
 *   HOST-PASSED ReactNodes (not registry slot contributions) on purpose:
 *   the ChatPluginSlot mount wraps contributions in a `display: contents`
 *   div, which would change the DOM the admin regression suite pins —
 *   passing elements keeps the DOM byte-identical. KodyChat loads these
 *   components via React.lazy (Step 7 bundle check) so they stay out of
 *   the /client route chunk; the always-called useBrainImageSave hook
 *   lives in use-brain-image-save.ts (hooks cannot be lazy).
 *   NOTE: imports RepoScopedLink from components/ — an app-wide shared
 *   component, allowed by the lint zones (plugins are only barred from
 *   sibling plugins).
 */
"use client";

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

import { RepoScopedLink } from "../../../components/RepoScopedLink";
import {
  flyMachineTerminalLabel,
  flyTerminalTargetLabel,
  type FlyMachineRow,
} from "../../../runners/fly-machine-model";
import {
  terminalFlyMachineKey,
  terminalMachineIdShort,
} from "./registry-state";
import type {
  ChatTerminalConnectionState,
  ChatTerminalMode,
  ChatTerminalTransport,
} from "./types";

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
