"use client";

import { useRef, useState } from "react";
import {
  Copy,
  EyeOff,
  Image,
  Link,
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
  "h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50";
const actionClass =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const controlLabelClass = "text-[11px] font-medium text-zinc-500";
const controlValueClass =
  "min-w-12 text-right font-mono text-[11px] text-zinc-400";

type StyleName =
  | "color"
  | "backgroundColor"
  | "fontSize"
  | "fontWeight"
  | "padding"
  | "margin"
  | "gap"
  | "border"
  | "borderRadius"
  | "boxShadow"
  | "width"
  | "maxWidth";

function firstPx(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) return fallback;
  const next = Number(match[0]);
  return Number.isFinite(next) ? next : fallback;
}

function toPx(value: number): string {
  return `${Math.round(value)}px`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function componentToHex(n: number): string {
  return clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
}

function colorToHex(value: string | undefined, fallback = "#000000"): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  const rgb = trimmed.match(
    /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/i,
  );
  if (!rgb) return fallback;
  return `#${componentToHex(Number(rgb[1]))}${componentToHex(Number(rgb[2]))}${componentToHex(Number(rgb[3]))}`;
}

function normalizeFontWeight(value: string | undefined): string {
  const trimmed = (value ?? "").trim().toLowerCase();
  if (trimmed === "normal") return "400";
  if (trimmed === "bold") return "700";
  if (/^\d+$/.test(trimmed)) return trimmed;
  return "400";
}

function ColorControl({
  label,
  value,
  fallback,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const hex = colorToHex(value, fallback);
  return (
    <label className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
      <span className={controlLabelClass}>{label}</span>
      <input
        type="color"
        value={hex}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="ml-auto h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={label}
      />
      <span className="w-16 font-mono text-[11px] text-zinc-400">{hex}</span>
    </label>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const numeric = clamp(firstPx(value, min), min, max);
  const percent = max === min ? 0 : ((numeric - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number } | null>(null);
  const scrubRef = useRef<{
    pointerId: number;
    startX: number;
    startValue: number;
  } | null>(null);
  const applyNumericValue = (next: number): void => {
    const stepped = Math.round(next / step) * step;
    onChange(toPx(clamp(stepped, min, max)));
  };
  const valueFromClientX = (clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return min + ratio * (max - min);
  };
  const applyPointerValue = (clientX: number): void => {
    const next = valueFromClientX(clientX);
    if (next === null) return;
    applyNumericValue(next);
  };
  const stopDragging = (pointerId: number): void => {
    if (dragRef.current?.pointerId === pointerId) {
      dragRef.current = null;
    }
  };
  return (
    <label className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={controlLabelClass}>{label}</span>
        <span
          role="spinbutton"
          aria-label={`${label} value`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={numeric}
          tabIndex={disabled ? -1 : 0}
          className={cn(
            controlValueClass,
            "cursor-ew-resize select-none rounded px-1 py-0.5 hover:bg-zinc-800 hover:text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100 focus:outline-none",
            disabled && "cursor-not-allowed opacity-50",
          )}
          onPointerDown={(event) => {
            if (disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            scrubRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startValue: numeric,
            };
          }}
          onPointerMove={(event) => {
            const scrub = scrubRef.current;
            if (!scrub || scrub.pointerId !== event.pointerId) return;
            applyNumericValue(
              scrub.startValue + (event.clientX - scrub.startX),
            );
          }}
          onPointerUp={(event) => {
            if (scrubRef.current?.pointerId === event.pointerId) {
              scrubRef.current = null;
            }
          }}
          onPointerCancel={(event) => {
            if (scrubRef.current?.pointerId === event.pointerId) {
              scrubRef.current = null;
            }
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              applyNumericValue(numeric + step);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              applyNumericValue(numeric - step);
            }
          }}
          title="Drag left or right"
        >
          {toPx(numeric)}
        </span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={numeric}
        className={cn(
          "relative h-8 touch-none select-none outline-none",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-ew-resize",
        )}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId };
          applyPointerValue(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          applyPointerValue(event.clientX);
        }}
        onPointerUp={(event) => stopDragging(event.pointerId)}
        onPointerCancel={(event) => stopDragging(event.pointerId)}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            applyNumericValue(numeric + step);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            applyNumericValue(numeric - step);
          } else if (event.key === "Home") {
            event.preventDefault();
            applyNumericValue(min);
          } else if (event.key === "End") {
            event.preventDefault();
            applyNumericValue(max);
          }
        }}
      >
        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-zinc-700 shadow-inner" />
        <div
          className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-blue-500"
          style={{ width: `${percent}%` }}
        />
        <div
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-300 bg-blue-500 shadow-sm shadow-blue-950/40 ring-2 ring-blue-500/20"
          style={{ left: `${percent}%` }}
        />
      </div>
    </label>
  );
}

function SelectControl({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className={controlLabelClass}>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="ml-auto h-8 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
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
    fontWeight: normalizeFontWeight(computedStyles.fontWeight),
    padding: computedStyles.padding ?? "",
    margin: computedStyles.margin ?? "",
    gap: computedStyles.gap ?? "",
    border: computedStyles.border ?? "",
    borderRadius: computedStyles.borderRadius ?? "",
    boxShadow: computedStyles.boxShadow ?? "",
    width: computedStyles.width ?? "",
    maxWidth: computedStyles.maxWidth ?? "",
  });

  const updateStyle = (name: StyleName, value: string): void => {
    setStyles((prev) => ({ ...prev, [name]: value }));
    const clean = value.trim();
    if (!clean) return;
    void onApply({ op: "style", styles: { [name]: clean } });
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
            Style
          </div>
          <div className="space-y-3 rounded border border-zinc-800 bg-zinc-900/30 p-2.5">
            <div className="grid grid-cols-1 gap-2">
              <ColorControl
                label="Text"
                value={styles.color}
                fallback="#ffffff"
                disabled={busy}
                onChange={(value) => updateStyle("color", value)}
              />
              <ColorControl
                label="Fill"
                value={styles.backgroundColor}
                fallback="#111827"
                disabled={busy}
                onChange={(value) => updateStyle("backgroundColor", value)}
              />
            </div>

            <div className="space-y-2 border-t border-zinc-800 pt-2">
              <SliderControl
                label="Font size"
                value={styles.fontSize}
                min={8}
                max={96}
                disabled={busy}
                onChange={(value) => updateStyle("fontSize", value)}
              />
              <SelectControl
                label="Weight"
                value={styles.fontWeight}
                disabled={busy}
                onChange={(value) => updateStyle("fontWeight", value)}
                options={[
                  { label: "Thin", value: "100" },
                  { label: "Extra light", value: "200" },
                  { label: "Light", value: "300" },
                  { label: "Regular", value: "400" },
                  { label: "Medium", value: "500" },
                  { label: "Semibold", value: "600" },
                  { label: "Bold", value: "700" },
                  { label: "Extra bold", value: "800" },
                  { label: "Black", value: "900" },
                ]}
              />
            </div>

            <div className="space-y-2 border-t border-zinc-800 pt-2">
              <SliderControl
                label="Padding"
                value={styles.padding}
                min={0}
                max={96}
                disabled={busy}
                onChange={(value) => updateStyle("padding", value)}
              />
              <SliderControl
                label="Margin"
                value={styles.margin}
                min={0}
                max={96}
                disabled={busy}
                onChange={(value) => updateStyle("margin", value)}
              />
              <SliderControl
                label="Gap"
                value={styles.gap}
                min={0}
                max={80}
                disabled={busy}
                onChange={(value) => updateStyle("gap", value)}
              />
            </div>

            <div className="space-y-2 border-t border-zinc-800 pt-2">
              <SliderControl
                label="Radius"
                value={styles.borderRadius}
                min={0}
                max={64}
                disabled={busy}
                onChange={(value) => updateStyle("borderRadius", value)}
              />
              <SliderControl
                label="Width"
                value={styles.width}
                min={0}
                max={1200}
                step={10}
                disabled={busy}
                onChange={(value) => updateStyle("width", value)}
              />
              <SliderControl
                label="Max width"
                value={styles.maxWidth}
                min={0}
                max={1200}
                step={10}
                disabled={busy}
                onChange={(value) => updateStyle("maxWidth", value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 border-t border-zinc-800 pt-2">
              <input
                value={styles.border}
                onChange={(event) => updateStyle("border", event.target.value)}
                placeholder="border, e.g. 1px solid #ddd"
                disabled={busy}
                className={inputClass}
              />
              <input
                value={styles.boxShadow}
                onChange={(event) =>
                  updateStyle("boxShadow", event.target.value)
                }
                placeholder="shadow"
                disabled={busy}
                className={inputClass}
              />
            </div>
          </div>
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
