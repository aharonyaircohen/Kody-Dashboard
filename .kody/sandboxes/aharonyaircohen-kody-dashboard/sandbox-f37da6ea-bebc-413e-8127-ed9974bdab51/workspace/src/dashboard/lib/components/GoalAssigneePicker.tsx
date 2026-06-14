/**
 * @fileType component
 * @domain kody
 * @pattern goal-assignee-picker
 * @ai-summary Single-owner picker for a goal. Controlled (value/onChange) so it
 *   works in both the create/edit dialog (parent holds local state) and the
 *   inline header chip (parent wires onChange to the update mutation).
 *
 *   Goals are intentionally single-owner — accountability lives on one person.
 *   Tasks under the goal still have their own multi-assignee lists.
 */
"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, User, X } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@dashboard/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@dashboard/ui/avatar";
import { useCollaborators } from "../hooks";

export interface GoalAssigneePickerProps {
  /** Current owner login, or null/undefined when unassigned. */
  value: string | null | undefined;
  /** Called with the new login, or null to clear. */
  onChange: (login: string | null) => void;
  /** When true, the picker shows a saving spinner and disables interaction. */
  pending?: boolean;
  /** Compact = small chip for inline use; default = full row for dialogs. */
  variant?: "default" | "compact";
  /** Hide the leading icon (useful inside dense headers). */
  hideIcon?: boolean;
}

export function GoalAssigneePicker({
  value,
  onChange,
  pending,
  variant = "default",
  hideIcon,
}: GoalAssigneePickerProps) {
  const { data: collaborators = [], isLoading } = useCollaborators();
  const [open, setOpen] = useState(false);

  const currentLogin = value?.trim() || null;
  const current = useMemo(
    () =>
      currentLogin
        ? (collaborators.find((c) => c.login === currentLogin) ?? {
            login: currentLogin,
            avatar_url: "",
          })
        : null,
    [currentLogin, collaborators],
  );

  const available = useMemo(
    () => collaborators.filter((c) => c.login !== currentLogin),
    [collaborators, currentLogin],
  );

  const handleSelect = (login: string) => {
    setOpen(false);
    if (login === currentLogin) return;
    onChange(login);
  };

  const handleClear = () => {
    if (!currentLogin) return;
    onChange(null);
  };

  const compact = variant === "compact";

  // ── Current owner chip ──────────────────────────────────────────────────
  const ownerChip = current ? (
    <div
      className={
        compact
          ? "group inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] pl-1 pr-1.5 py-0.5 text-xs"
          : "group flex items-center gap-2 bg-background px-2 py-1.5 rounded-md border border-border/50"
      }
    >
      <Avatar className={compact ? "h-4 w-4" : "h-5 w-5"}>
        <AvatarImage src={current.avatar_url} alt={current.login} />
        <AvatarFallback className="text-[10px]">
          {current.login[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span
        className={
          compact ? "text-xs text-foreground" : "text-xs text-foreground flex-1"
        }
      >
        {current.login}
      </span>
      <button
        type="button"
        onClick={handleClear}
        disabled={pending}
        className={
          (compact
            ? "p-0.5 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground"
            : "opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-opacity") +
          " disabled:opacity-50"
        }
        title={`Unassign ${current.login}`}
      >
        {pending ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <X className="w-3 h-3" />
        )}
      </button>
    </div>
  ) : null;

  // ── Trigger (Add / Change) ──────────────────────────────────────────────
  const triggerLabel = current ? "Change" : "Assign owner";
  const TriggerIcon = pending ? Loader2 : current ? User : Plus;

  return (
    <div className={compact ? "inline-flex items-center gap-1.5" : "space-y-2"}>
      {ownerChip}
      {!compact && !current ? (
        <span className="text-xs text-muted-foreground italic">Unassigned</span>
      ) : null}

      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={
              compact
                ? "h-6 px-2 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                : "h-7 w-full justify-start gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            }
            disabled={pending}
          >
            {!hideIcon ? (
              <TriggerIcon
                className={
                  (pending ? "w-3 h-3 animate-spin" : "w-3 h-3") +
                  (compact ? "" : "")
                }
              />
            ) : null}
            {triggerLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {isLoading ? (
            <DropdownMenuItem disabled className="flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading collaborators…
            </DropdownMenuItem>
          ) : available.length === 0 ? (
            <DropdownMenuItem disabled className="text-muted-foreground">
              {collaborators.length === 0
                ? "No collaborators"
                : "No other collaborators"}
            </DropdownMenuItem>
          ) : (
            available.map((user) => (
              <DropdownMenuItem
                key={user.login}
                onClick={() => handleSelect(user.login)}
                disabled={pending}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Avatar className="h-5 w-5">
                  <AvatarImage src={user.avatar_url} alt={user.login} />
                  <AvatarFallback className="text-[8px]">
                    {user.login[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span>{user.login}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
