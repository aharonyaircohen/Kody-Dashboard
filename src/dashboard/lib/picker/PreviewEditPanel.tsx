"use client";

import { useState } from "react";
import {
  Copy,
  EyeOff,
  Image,
  Link,
  Paintbrush,
  RotateCcw,
  Send,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "../utils";
import type { PickedElement, PreviewEditMutation } from "./protocol";

interface PreviewEditPanelProps {
  element: PickedElement;
  changeCount: number;
  busy: boolean;
  onApply: (mutation: PreviewEditMutation) => Promise<void>;
  onUndo: () => Promise<void>;
  onResetSelected: () => Promise<void>;
  onResetAll: () => Promise<void>;
  onAskKody: () => Promise<void>;
  onClose: () => void;
}

const inputClass =
  "h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-blue-500";
const actionClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

function compactChangedStyles(
  styles: Record<string, string>,
  changed: Set<string>,
): PreviewEditMutation | null {
  const clean = Object.fromEntries(
    Object.entries(styles)
      .filter(([key]) => changed.has(key))
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value),
  );
  return Object.keys(clean).length ? { op: "style", styles: clean } : null;
}

export function PreviewEditPanel({
  element,
  changeCount,
  busy,
  onApply,
  onUndo,
  onResetSelected,
  onResetAll,
  onAskKody,
  onClose,
}: PreviewEditPanelProps) {
  const [textValue, setTextValue] = useState(element.text);
  const [hrefValue, setHrefValue] = useState(element.attributes.href ?? "");
  const [srcValue, setSrcValue] = useState(element.attributes.src ?? "");
  const [altValue, setAltValue] = useState(element.attributes.alt ?? "");
  const computedStyles = element.computedStyles ?? {};
  const [styles, setStyles] = useState({
    color: computedStyles.color ?? "",
    backgroundColor: computedStyles.backgroundColor ?? "",
    fontSize: computedStyles.fontSize ?? "",
    fontWeight: computedStyles.fontWeight ?? "",
    padding: computedStyles.padding ?? "",
    margin: computedStyles.margin ?? "",
    gap: computedStyles.gap ?? "",
    border: computedStyles.border ?? "",
    borderRadius: computedStyles.borderRadius ?? "",
    boxShadow: computedStyles.boxShadow ?? "",
    width: computedStyles.width ?? "",
    maxWidth: computedStyles.maxWidth ?? "",
  });
  const [changedStyles, setChangedStyles] = useState<Set<string>>(
    () => new Set(),
  );

  const updateStyle = (name: keyof typeof styles, value: string): void => {
    setStyles((prev) => ({ ...prev, [name]: value }));
    setChangedStyles((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const applyStyles = async (): Promise<void> => {
    const mutation = compactChangedStyles(styles, changedStyles);
    if (!mutation) return;
    await onApply(mutation);
    setChangedStyles(new Set());
  };

  const hasHref = element.tagName === "a" || "href" in element.attributes;
  const hasSrc =
    element.tagName === "img" ||
    element.tagName === "source" ||
    "src" in element.attributes;

  return (
    <div className="max-h-[min(520px,calc(100vh-24px))] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-md border border-zinc-700 bg-zinc-950 p-3 shadow-2xl">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-zinc-100">
            {element.selector}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-500">
            {element.tagName}
            {changeCount > 0
              ? ` · ${changeCount} edit${changeCount === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-white"
          title="Close editor"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <Paintbrush className="h-3 w-3" />
            Style
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={styles.color}
              onChange={(event) => updateStyle("color", event.target.value)}
              placeholder="color"
              className={inputClass}
            />
            <input
              value={styles.backgroundColor}
              onChange={(event) =>
                updateStyle("backgroundColor", event.target.value)
              }
              placeholder="background"
              className={inputClass}
            />
            <input
              value={styles.fontSize}
              onChange={(event) => updateStyle("fontSize", event.target.value)}
              placeholder="font size"
              className={inputClass}
            />
            <input
              value={styles.fontWeight}
              onChange={(event) =>
                updateStyle("fontWeight", event.target.value)
              }
              placeholder="font weight"
              className={inputClass}
            />
            <input
              value={styles.padding}
              onChange={(event) => updateStyle("padding", event.target.value)}
              placeholder="padding"
              className={inputClass}
            />
            <input
              value={styles.margin}
              onChange={(event) => updateStyle("margin", event.target.value)}
              placeholder="margin"
              className={inputClass}
            />
            <input
              value={styles.gap}
              onChange={(event) => updateStyle("gap", event.target.value)}
              placeholder="gap"
              className={inputClass}
            />
            <input
              value={styles.border}
              onChange={(event) => updateStyle("border", event.target.value)}
              placeholder="border"
              className={inputClass}
            />
            <input
              value={styles.borderRadius}
              onChange={(event) =>
                updateStyle("borderRadius", event.target.value)
              }
              placeholder="radius"
              className={inputClass}
            />
            <input
              value={styles.boxShadow}
              onChange={(event) => updateStyle("boxShadow", event.target.value)}
              placeholder="shadow"
              className={inputClass}
            />
            <input
              value={styles.width}
              onChange={(event) => updateStyle("width", event.target.value)}
              placeholder="width"
              className={inputClass}
            />
            <input
              value={styles.maxWidth}
              onChange={(event) => updateStyle("maxWidth", event.target.value)}
              placeholder="max width"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={() => void applyStyles()}
            disabled={busy || changedStyles.size === 0}
            className={cn(actionClass, "w-full")}
          >
            <Paintbrush className="h-3.5 w-3.5" />
            Apply style
          </button>
        </section>

        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            <Type className="h-3 w-3" />
            Content
          </div>
          <div className="flex gap-2">
            <input
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder="text"
              className={cn(inputClass, "min-w-0 flex-1")}
            />
            <button
              type="button"
              onClick={() => void onApply({ op: "text", value: textValue })}
              disabled={busy}
              className={actionClass}
            >
              <Type className="h-3.5 w-3.5" />
            </button>
          </div>

          {hasHref && (
            <div className="flex gap-2">
              <input
                value={hrefValue}
                onChange={(event) => setHrefValue(event.target.value)}
                placeholder="href"
                className={cn(inputClass, "min-w-0 flex-1")}
              />
              <button
                type="button"
                onClick={() =>
                  void onApply({
                    op: "attribute",
                    name: "href",
                    value: hrefValue,
                  })
                }
                disabled={busy}
                className={actionClass}
              >
                <Link className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {hasSrc && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={srcValue}
                onChange={(event) => setSrcValue(event.target.value)}
                placeholder="src"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() =>
                  void onApply({
                    op: "attribute",
                    name: "src",
                    value: srcValue,
                  })
                }
                disabled={busy}
                className={actionClass}
              >
                <Image className="h-3.5 w-3.5" />
              </button>
              <input
                value={altValue}
                onChange={(event) => setAltValue(event.target.value)}
                placeholder="alt"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() =>
                  void onApply({
                    op: "attribute",
                    name: "alt",
                    value: altValue,
                  })
                }
                disabled={busy}
                className={actionClass}
              >
                <Image className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </section>

        <section className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void onApply({ op: "hide" })}
            disabled={busy}
            className={actionClass}
          >
            <EyeOff className="h-3.5 w-3.5" />
            Hide
          </button>
          <button
            type="button"
            onClick={() => void onApply({ op: "duplicate" })}
            disabled={busy}
            className={actionClass}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </button>
          <button
            type="button"
            onClick={() => void onApply({ op: "remove" })}
            disabled={busy}
            className={actionClass}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </section>

        <div className="grid grid-cols-3 gap-2 border-t border-zinc-800 pt-3">
          <button
            type="button"
            onClick={() => void onUndo()}
            disabled={busy || changeCount === 0}
            className={actionClass}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </button>
          <button
            type="button"
            onClick={() => void onResetSelected()}
            disabled={busy || changeCount === 0}
            className={actionClass}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => void onResetAll()}
            disabled={busy || changeCount === 0}
            className={actionClass}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            All
          </button>
        </div>

        <button
          type="button"
          onClick={() => void onAskKody()}
          disabled={busy || changeCount === 0}
          className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          Ask Kody to apply
        </button>
      </div>
    </div>
  );
}
