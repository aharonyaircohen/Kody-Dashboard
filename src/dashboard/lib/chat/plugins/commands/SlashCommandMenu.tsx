/**
 * @fileType component
 * @domain chat-plugin-commands
 * @pattern slash-menu
 * @ai-summary Floating menu shown above the chat composer while the
 *   user types a slash command. Filters commands by prefix, supports
 *   keyboard navigation (handled by the parent via onKeyDown to keep
 *   focus inside the textarea), and dispatches selection to the parent.
 *   Position-coupled to the composer textarea, so the host builds this
 *   node and passes it into the Composer as a ReactNode — same pattern
 *   as the terminal plugin's chrome (Step 5b).
 */
"use client";

import { useMemo } from "react";
import { RepoScopedLink } from "../../../components/RepoScopedLink";
import type { SlashCommand } from "./useSlashCommands";

interface Props {
  commands: SlashCommand[];
  filter: string;
  selectedIndex: number;
  onSelect: (slug: string) => void;
  onHover: (index: number) => void;
}

export function filterCommands(
  commands: SlashCommand[],
  filter: string,
): SlashCommand[] {
  const f = filter.toLowerCase();
  if (!f) return commands;
  return commands.filter(
    (p) =>
      p.slug.toLowerCase().startsWith(f) ||
      p.description.toLowerCase().includes(f),
  );
}

export function SlashCommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
  onHover,
}: Props) {
  const filtered = useMemo(
    () => filterCommands(commands, filter),
    [commands, filter],
  );

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full start-0 end-0 mb-2 rounded-md border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-xl px-3 py-2 text-xs text-white/50">
        No matching commands. Manage them at{" "}
        <RepoScopedLink
          className="underline hover:text-white/80"
          href="/commands"
        >
          /commands
        </RepoScopedLink>
        .
      </div>
    );
  }

  return (
    <div className="absolute bottom-full start-0 end-0 mb-2 rounded-md border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-xl overflow-hidden max-h-64 overflow-y-auto">
      <ul role="listbox" className="py-1">
        {filtered.map((p, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <li
              key={p.slug}
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => onHover(idx)}
              onMouseDown={(e) => {
                // Prevent textarea blur before click registers.
                e.preventDefault();
                onSelect(p.slug);
              }}
              className={`flex items-baseline gap-2 px-3 py-1.5 cursor-pointer ${
                isSelected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
              }`}
            >
              <span className="font-mono text-sm text-white/90">/{p.slug}</span>
              {p.argumentHint && (
                <span className="font-mono text-[11px] text-white/40">
                  {p.argumentHint}
                </span>
              )}
              {p.description && (
                <span className="text-xs text-white/55 truncate ms-1">
                  {p.description}
                </span>
              )}
              <span
                className={`ms-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${
                  p.source === "builtin"
                    ? "bg-white/[0.05] text-white/40"
                    : "bg-emerald-500/15 text-emerald-300/80"
                }`}
              >
                {p.source}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-white/35 flex items-center justify-between">
        <span>↑↓ navigate · Enter/Tab select · Esc close</span>
        <RepoScopedLink
          href="/commands"
          className="underline hover:text-white/70"
        >
          Manage
        </RepoScopedLink>
      </div>
    </div>
  );
}
