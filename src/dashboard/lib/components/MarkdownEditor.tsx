/**
 * @fileType component
 * @domain kody
 * @pattern markdown-editor
 * @ai-summary Controlled markdown editor with shared rich preview, split mode,
 * and formatting helpers for common Markdown blocks.
 */

"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  Bold,
  Braces,
  Code,
  Columns2,
  Edit3,
  Eye,
  Heading,
  Italic,
  Link2,
  List,
  ListChecks,
  Quote,
  Redo2,
  Table2,
  Undo2,
  Workflow,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Textarea } from "@dashboard/ui/textarea";
import { cn } from "@dashboard/lib/utils/ui";
import { EMOJI_LIST } from "../constants";
import { autoDirProps, rtlAwareMarkdownClassName } from "../text-direction";
import { MarkdownPreview } from "./MarkdownPreview";

type EditorMode = "write" | "preview" | "split";

interface MarkdownEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  className?: string;
  /** Optional override for preview empty-state message */
  emptyPreview?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
  disabled,
  className,
  emptyPreview = "*Nothing to preview*",
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>("write");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const updateValue = (
    next: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ) => {
    onChange(next);
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }, 0);
  };

  const withSelection = (
    build: (selection: { start: number; end: number; selected: string }) => {
      next: string;
      selectionStart: number;
      selectionEnd?: number;
    },
  ) => {
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const result = build({ start, end, selected });
    updateValue(result.next, result.selectionStart, result.selectionEnd);
  };

  const insertInline = (before: string, after = before, fallback = "") => {
    withSelection(({ start, end, selected }) => {
      const content = selected || fallback;
      const next =
        value.slice(0, start) + before + content + after + value.slice(end);
      const selectionStart = start + before.length;
      const selectionEnd = selectionStart + content.length;
      return { next, selectionStart, selectionEnd };
    });
  };

  const insertAtLineStart = (prefix: string) => {
    withSelection(({ start, end, selected }) => {
      const lineStart = value.lastIndexOf("\n", start - 1) + 1;
      const content = selected || "";
      const lines = content.length > 0 ? content.split("\n") : [""];
      const replacement = lines.map((line) => `${prefix}${line}`).join("\n");
      const next = value.slice(0, lineStart) + replacement + value.slice(end);
      const selectionStart = lineStart + prefix.length;
      const selectionEnd = lineStart + replacement.length;
      return { next, selectionStart, selectionEnd };
    });
  };

  const insertBlock = (block: string, selectionOffset = block.length) => {
    withSelection(({ start, end }) => {
      const needsLeadingBreak = start > 0 && value[start - 1] !== "\n";
      const needsTrailingBreak = end < value.length && value[end] !== "\n";
      const leading = needsLeadingBreak ? "\n" : "";
      const trailing = needsTrailingBreak ? "\n" : "";
      const next =
        value.slice(0, start) + leading + block + trailing + value.slice(end);
      const cursor = start + leading.length + selectionOffset;
      return { next, selectionStart: cursor };
    });
  };

  const insertEmoji = (emoji: string) => {
    insertInline(emoji, "", "");
    setShowEmojiPicker(false);
  };

  const runTextareaCommand = (command: "undo" | "redo") => {
    if (disabled) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    document.execCommand(command);
  };

  const preview = (
    <div
      {...autoDirProps}
      className={cn(
        "min-h-[120px] max-h-[50vh] min-w-0 w-full overflow-auto p-3 border border-border rounded-md bg-background text-start",
        rtlAwareMarkdownClassName,
      )}
    >
      <MarkdownPreview content={value || emptyPreview} variant="compact" />
    </div>
  );

  const editor = (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      dir="auto"
      className="font-mono text-sm resize-y max-h-[50vh] text-start"
    />
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center flex-wrap gap-0.5 border border-border rounded-md p-1 bg-muted/30">
        <ToolbarButton
          title="Undo"
          onClick={() => runTextareaCommand("undo")}
          disabled={disabled}
        >
          <Undo2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Redo"
          onClick={() => runTextareaCommand("redo")}
          disabled={disabled}
        >
          <Redo2 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          title="Bold"
          onClick={() => insertInline("**", "**", "bold")}
          disabled={disabled}
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          onClick={() => insertInline("*", "*", "italic")}
          disabled={disabled}
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Inline code"
          onClick={() => insertInline("`", "`", "code")}
          disabled={disabled}
        >
          <Code className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Link"
          onClick={() => insertInline("[", "](url)", "link")}
          disabled={disabled}
        >
          <Link2 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          title="Heading"
          onClick={() => insertAtLineStart("## ")}
          disabled={disabled}
        >
          <Heading className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Quote"
          onClick={() => insertAtLineStart("> ")}
          disabled={disabled}
        >
          <Quote className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="List"
          onClick={() => insertAtLineStart("- ")}
          disabled={disabled}
        >
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Checklist"
          onClick={() => insertAtLineStart("- [ ] ")}
          disabled={disabled}
        >
          <ListChecks className="w-3.5 h-3.5" />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          title="Code block"
          onClick={() => insertBlock("```ts\n\n```", "```ts\n".length)}
          disabled={disabled}
        >
          <Braces className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Mermaid diagram"
          onClick={() =>
            insertBlock(
              "```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```",
              "```mermaid\n".length,
            )
          }
          disabled={disabled}
        >
          <Workflow className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Callout"
          onClick={() => insertBlock("> [!NOTE]\n> ", "> [!NOTE]\n> ".length)}
          disabled={disabled}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Table"
          onClick={() =>
            insertBlock(
              "| Name | Value |\n| --- | --- |\n| Item | Detail |",
              "| Name | Value |\n| --- | --- |\n| ".length,
            )
          }
          disabled={disabled}
        >
          <Table2 className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            className="h-7 w-7 p-0 text-sm"
            title="Emoji"
            disabled={disabled}
          >
            😊
          </Button>

          {showEmojiPicker ? (
            <div className="absolute z-20 top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto border border-border rounded-md shadow-lg bg-popover p-2 grid grid-cols-6 gap-1">
              {EMOJI_LIST.slice(0, 60).map((emoji, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="p-1 hover:bg-accent rounded text-lg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <ToolbarDivider />

        <ModeButton mode={mode} target="write" onClick={setMode} title="Write">
          <Edit3 className="w-3.5 h-3.5" />
        </ModeButton>
        <ModeButton
          mode={mode}
          target="preview"
          onClick={setMode}
          title="Preview"
        >
          <Eye className="w-3.5 h-3.5" />
        </ModeButton>
        <ModeButton mode={mode} target="split" onClick={setMode} title="Split">
          <Columns2 className="w-3.5 h-3.5" />
        </ModeButton>
        <span className="ml-auto px-2 text-[11px] tabular-nums text-muted-foreground">
          {value.length}
        </span>
      </div>

      {mode === "preview" ? preview : null}
      {mode === "write" ? editor : null}
      {mode === "split" ? (
        <div className="grid gap-2 md:grid-cols-2">
          {editor}
          {preview}
        </div>
      ) : null}
    </div>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

function ToolbarButton({
  title,
  onClick,
  children,
  disabled,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 w-7 p-0"
      title={title}
      disabled={disabled}
    >
      {children}
    </Button>
  );
}

function ModeButton({
  mode,
  target,
  onClick,
  title,
  children,
}: {
  mode: EditorMode;
  target: EditorMode;
  onClick: (mode: EditorMode) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={mode === target ? "secondary" : "ghost"}
      size="sm"
      onClick={() => onClick(target)}
      className="h-7 w-7 p-0"
      title={title}
    >
      {children}
    </Button>
  );
}
