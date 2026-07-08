/**
 * @fileType component
 * @domain kody
 * @pattern chat-surface
 * @ai-summary Renders a `show_view` directive as generic UI atoms (stack /
 * row / list / text / markdown / input / button / checkbox / submit) inside
 * an assistant bubble. Extracted verbatim from KodyChat (Step 3); action
 * handling stays with the host via `onAction`.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Check, MousePointerClick, X } from "lucide-react";
import { MarkdownPreview } from "../../components/MarkdownPreview";
import {
  getRenderedViewUi,
  type RenderedViewAction,
  type RenderedViewDirective,
  type RenderedViewUiNode,
} from "@dashboard/lib/chat-ui-actions";

export function RenderedViewCard({
  view,
  disabled,
  onAction,
}: {
  view: RenderedViewDirective;
  disabled: boolean;
  onAction: (action: RenderedViewAction) => void;
}) {
  const ui = getRenderedViewUi(view);
  const [formValues, setFormValues] = useState<
    Record<string, Array<{ value: string; label: string }>>
  >({});
  const toggleFormValue = (name: string, value: string, label: string) => {
    setFormValues((current) => {
      const values = current[name] ?? [];
      const nextValues = values.some((candidate) => candidate.value === value)
        ? values.filter((candidate) => candidate.value !== value)
        : [...values, { value, label }];
      return { ...current, [name]: nextValues };
    });
  };
  const submitForm = (label: string) => {
    const selected = Object.values(formValues).flat();
    const selectedText =
      selected.length > 0
        ? selected
            .map((item) =>
              item.value === item.label
                ? item.label
                : `${item.label} (${item.value})`,
            )
            .join(", ")
        : "none";
    onAction({
      id: "submit",
      label,
      response: `Selected: ${selectedText}`,
      result: formValues,
    });
  };
  const renderButton = (
    node: Extract<RenderedViewUiNode, { type: "button" }>,
    key: string,
    layout: "row" | "list",
  ) => {
    const isPrimary = node.action.variant === "primary";
    const isDanger = node.action.variant === "danger";
    const Icon = isPrimary ? Check : isDanger ? X : MousePointerClick;
    const tone = isPrimary
      ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
      : isDanger
        ? "border-destructive/40 text-destructive hover:bg-destructive/10"
        : "border-border bg-background hover:bg-accent";
    if (layout === "list") {
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => onAction(node.action)}
          className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
        >
          <span className="min-w-0 truncate font-medium">{node.label}</span>
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      );
    }
    return (
      <button
        key={key}
        type="button"
        disabled={disabled}
        onClick={() => onAction(node.action)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
      >
        <Icon className="h-3.5 w-3.5" />
        {node.label}
      </button>
    );
  };
  const renderNode = (
    node: RenderedViewUiNode,
    key: string,
    layout: "row" | "list" = "row",
  ): ReactNode => {
    if (node.type === "stack") {
      return (
        <div key={key} className="space-y-3">
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`),
          )}
        </div>
      );
    }
    if (node.type === "row") {
      return (
        <div key={key} className="flex flex-wrap gap-2">
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`, "row"),
          )}
        </div>
      );
    }
    if (node.type === "list") {
      return (
        <div key={key} className="space-y-1.5">
          {node.children.map((child, index) =>
            renderNode(child, `${key}-${index}`, "list"),
          )}
        </div>
      );
    }
    if (node.type === "text") {
      if (node.variant === "title") {
        return (
          <div key={key} className="font-medium text-foreground">
            {node.value}
          </div>
        );
      }
      if (node.variant === "label") {
        return (
          <div key={key} className="text-xs font-medium text-muted-foreground">
            {node.value}
          </div>
        );
      }
      return (
        <div key={key} className="text-muted-foreground">
          {node.value}
        </div>
      );
    }
    if (node.type === "markdown") {
      return (
        <MarkdownPreview
          key={key}
          content={node.value}
          className="chat-message-text break-words text-[15px] leading-7 prose-p:my-2 prose-li:my-1"
        />
      );
    }
    if (node.type === "input") {
      return (
        <label key={key} className="block space-y-1">
          {node.label ? (
            <span className="text-xs font-medium text-muted-foreground">
              {node.label}
            </span>
          ) : null}
          <input
            value={node.value}
            readOnly={node.readOnly ?? true}
            className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-sm text-foreground"
          />
        </label>
      );
    }
    if (node.type === "button") {
      return renderButton(node, key, layout);
    }
    if (node.type === "checkbox") {
      const checked = (formValues[node.name] ?? []).some(
        (candidate) => candidate.value === node.value,
      );
      return (
        <label
          key={key}
          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-start text-sm transition-colors ${
            checked
              ? "border-primary/50 bg-primary/10"
              : "border-border bg-background hover:bg-accent"
          } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggleFormValue(node.name, node.value, node.label)}
            className="h-4 w-4 shrink-0 rounded border-border accent-primary"
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {node.label}
          </span>
        </label>
      );
    }
    if (node.type === "submit") {
      return (
        <button
          key={key}
          type="button"
          disabled={disabled}
          onClick={() => submitForm(node.label)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          {node.label}
        </button>
      );
    }
    return null;
  };
  return (
    <div className="mt-3 rounded-md border border-border bg-background/80 p-3 text-sm">
      {renderNode(ui, "root")}
    </div>
  );
}
