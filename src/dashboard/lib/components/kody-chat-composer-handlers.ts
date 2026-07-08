"use client";

/**
 * @fileType hook
 * @domain chat-host
 * @pattern kody-chat-extraction (phase 1.6d)
 *
 * Composer input handlers for KodyChat — the key/slash/mention handler
 * block, extracted verbatim from KodyChat.tsx (phase 1.6d). The STATE
 * (input, slash menu, mention trigger, attachments) stays in KodyChat —
 * it is shared with the send pipeline wiring and the terminal host; this
 * hook only owns the handlers that read/write it. Behavior identical.
 */
import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  filterCommands,
  parseSlashTrigger,
  type SlashCommand,
} from "../chat/plugins/commands";
import {
  parseStaffMentionTrigger,
  replaceStaffMentionTrigger,
  type StaffMentionTrigger,
} from "../mentions/agent-mentions";
import type { ChatTerminalMode } from "../chat/plugins/terminal/types";
import type { Attachment, Message } from "./kody-chat-types";

interface UseComposerHandlersOptions {
  chatMode: ChatTerminalMode;
  isDesktop: boolean;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  attachments: Attachment[];
  messages: Message[];
  activeLoading: boolean;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  slashCommands: SlashCommand[];
  slashMenuOpen: boolean;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  slashSelectedIndex: number;
  setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
  agentMentionTrigger: StaffMentionTrigger | null;
  setAgentMentionTrigger: Dispatch<SetStateAction<StaffMentionTrigger | null>>;
  agentMentionSelectedIndex: number;
  setAgentMentionSelectedIndex: Dispatch<SetStateAction<number>>;
  filteredAgentMentions: Array<{ slug: string }>;
  sendMessage: () => void;
  handleStop: () => void;
}

export function useComposerHandlers({
  chatMode,
  isDesktop,
  input,
  setInput,
  attachments,
  messages,
  activeLoading,
  composerTextareaRef,
  slashCommands,
  slashMenuOpen,
  setSlashMenuOpen,
  slashSelectedIndex,
  setSlashSelectedIndex,
  agentMentionTrigger,
  setAgentMentionTrigger,
  agentMentionSelectedIndex,
  setAgentMentionSelectedIndex,
  filteredAgentMentions,
  sendMessage,
  handleStop,
}: UseComposerHandlersOptions) {
  // Apply a slash command to the input: replaces the entire input with
  // "/slug " so the user can immediately type arguments, OR sends right
  // away when the prompt takes no arguments and the user pressed Enter.
  const refreshAgentMentionTrigger = useCallback(
    (value: string, caretIndex: number | null | undefined) => {
      if (chatMode !== "ai") {
        setAgentMentionTrigger(null);
        return;
      }
      const trigger = parseStaffMentionTrigger(
        value,
        caretIndex ?? value.length,
      );
      setAgentMentionTrigger(trigger);
      setAgentMentionSelectedIndex(0);
    },
    [chatMode, setAgentMentionTrigger, setAgentMentionSelectedIndex],
  );

  const handleComposerInputChange = useCallback(
    (
      next: string,
      caretIndex: number | null | undefined,
      textarea?: HTMLTextAreaElement | null,
    ) => {
      setInput(next);
      refreshAgentMentionTrigger(next, caretIndex);
      // Slash menu opens on `/` at line start, stays open while
      // the user types the slug, closes when they add a space
      // or clear the slash.
      if (chatMode === "ai") {
        const trigger = parseSlashTrigger(next);
        setSlashMenuOpen(trigger.active && slashCommands.length > 0);
        if (trigger.active) setSlashSelectedIndex(0);
      } else {
        setSlashMenuOpen(false);
      }
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
      }
    },
    [
      chatMode,
      refreshAgentMentionTrigger,
      slashCommands.length,
      setInput,
      setSlashMenuOpen,
      setSlashSelectedIndex,
    ],
  );

  const applyAgentMentionSelection = useCallback(
    (slug: string) => {
      if (!agentMentionTrigger) return;
      const next = replaceStaffMentionTrigger(input, agentMentionTrigger, slug);
      const nextCaret = agentMentionTrigger.start + slug.length + 2;
      setInput(next);
      setAgentMentionTrigger(null);
      setAgentMentionSelectedIndex(0);
      requestAnimationFrame(() => {
        const textarea = composerTextareaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [
      agentMentionTrigger,
      input,
      composerTextareaRef,
      setInput,
      setAgentMentionTrigger,
      setAgentMentionSelectedIndex,
    ],
  );

  const applySlashSelection = (slug: string) => {
    const command = slashCommands.find((p) => p.slug === slug);
    if (!prompt) return;
    setSlashMenuOpen(false);
    setSlashSelectedIndex(0);
    // Always insert "/slug " and let the user add args (or hit Enter
    // again to send). Sending immediately on first select would break
    // the case where the prompt needs arguments.
    setInput(`/${slug} `);
  };

  // Close the slash menu + mention popover. The Composer calls this from
  // its onBlur after a small delay so the menus' onMouseDown can fire
  // before close (see the comment at the blur handler).
  const closeComposerMenus = useCallback(() => {
    setSlashMenuOpen(false);
    setAgentMentionTrigger(null);
  }, [setSlashMenuOpen, setAgentMentionTrigger]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      chatMode === "ai" &&
      agentMentionTrigger &&
      filteredAgentMentions.length > 0
    ) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAgentMentionSelectedIndex((i) =>
          Math.min(i + 1, filteredAgentMentions.length - 1),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAgentMentionSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked =
          filteredAgentMentions[
            Math.min(
              agentMentionSelectedIndex,
              filteredAgentMentions.length - 1,
            )
          ];
        if (picked) applyAgentMentionSelection(picked.slug);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAgentMentionTrigger(null);
        return;
      }
    }

    // Slash menu keyboard navigation. Only intercept when the menu is
    // open AND the input still looks like a slug-in-progress (so once
    // the user types a space the menu's gone and normal handling resumes).
    if (chatMode === "ai" && slashMenuOpen) {
      const { filter } = parseSlashTrigger(input);
      const matches = filterCommands(slashCommands, filter);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) =>
          Math.min(i + 1, Math.max(matches.length - 1, 0)),
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        if (matches.length > 0) {
          e.preventDefault();
          const picked =
            matches[Math.min(slashSelectedIndex, matches.length - 1)];
          if (picked) applySlashSelection(picked.slug);
          return;
        }
      }
    }
    // Desktop AI chat and terminal keep Enter-to-send. Mobile AI chat leaves
    // plain Enter to the textarea so the soft keyboard inserts a newline.
    if (
      (chatMode === "terminal" || isDesktop) &&
      e.key === "Enter" &&
      !e.shiftKey
    ) {
      e.preventDefault();
      sendMessage();
      return;
    }
    // Esc aborts a streaming reply.
    if (e.key === "Escape" && activeLoading) {
      e.preventDefault();
      handleStop();
      return;
    }
    // ↑ on an empty composer recalls the last user message for editing —
    // matches the shell history convention.
    if (
      chatMode === "ai" &&
      e.key === "ArrowUp" &&
      !input &&
      attachments.length === 0
    ) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        e.preventDefault();
        setInput(lastUser.content);
      }
    }
  };

  return {
    refreshAgentMentionTrigger,
    handleComposerInputChange,
    applyAgentMentionSelection,
    applySlashSelection,
    closeComposerMenus,
    handleKeyDown,
  };
}
