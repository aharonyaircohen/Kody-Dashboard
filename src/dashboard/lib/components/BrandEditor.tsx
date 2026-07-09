/**
 * @fileType component
 * @domain client-chat
 * @pattern brand-editor-dialog
 * @ai-summary Create/edit dialog for repo-backed client brands.
 */
"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import type {
  BrandAgentOption,
  BrandModelOption,
  BrandRow,
  SavePayload,
} from "./brands-manager-types";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

interface BrandEditorProps {
  initial: BrandRow | null;
  isNew: boolean;
  saving: boolean;
  existingSlugs: Set<string>;
  modelOptions: BrandModelOption[];
  agentOptions: BrandAgentOption[];
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

export function BrandEditor({
  initial,
  isNew,
  saving,
  existingSlugs,
  modelOptions,
  agentOptions,
  onClose,
  onSave,
}: BrandEditorProps) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [accent, setAccent] = useState(initial?.accent ?? "#0f766e");
  const [locale, setLocale] = useState(initial?.locale ?? "en");
  const [welcomeText, setWelcomeText] = useState(initial?.welcomeText ?? "");
  const [modelId, setModelId] = useState(initial?.modelId ?? "");
  const [agentSlug, setAgentSlug] = useState(initial?.agentSlug ?? "");
  const [touchedSlug, setTouchedSlug] = useState(false);

  const slugError = (() => {
    if (!isNew) return null;
    if (!touchedSlug) return null;
    if (!slug) return "Required";
    if (!SLUG_RE.test(slug)) {
      return "Use lowercase letters, digits, and dashes. Start with a letter or digit.";
    }
    if (existingSlugs.has(slug)) return `"${slug}" already exists`;
    return null;
  })();
  const nameError = name.trim().length === 0 ? "Required" : null;
  const accentError = HEX_RE.test(accent) ? null : "Use a 6-digit hex color.";
  const canSave =
    !saving &&
    !slugError &&
    !nameError &&
    !accentError &&
    (isNew ? !!slug : true);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New brand" : `Edit ${initial?.name ?? "brand"}`}
          </DialogTitle>
          <DialogDescription>
            {initial?.source === "builtin"
              ? "Saving creates a repo override for this fallback brand."
              : "Stored at brands/<slug>.json in the state repo."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="brand-slug" className="text-xs">
              Slug
            </Label>
            <Input
              id="brand-slug"
              value={slug}
              onChange={(event) => setSlug(normalizeSlug(event.target.value))}
              onBlur={() => setTouchedSlug(true)}
              disabled={!isNew}
              placeholder="acme"
              className="font-mono"
            />
            {slugError && (
              <p className="mt-1 text-xs text-rose-300">{slugError}</p>
            )}
          </div>

          <div>
            <Label htmlFor="brand-name" className="text-xs">
              Name
            </Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme"
            />
            {nameError && (
              <p className="mt-1 text-xs text-rose-300">{nameError}</p>
            )}
          </div>

          <div>
            <Label htmlFor="brand-accent" className="text-xs">
              Accent
            </Label>
            <div className="flex gap-2">
              <Input
                id="brand-accent"
                type="color"
                value={HEX_RE.test(accent) ? accent : "#0f766e"}
                onChange={(event) => setAccent(event.target.value)}
                className="h-10 w-12 shrink-0 p-1"
                aria-label="Brand accent color"
              />
              <Input
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
                placeholder="#0f766e"
                className="font-mono"
              />
            </div>
            {accentError && (
              <p className="mt-1 text-xs text-rose-300">{accentError}</p>
            )}
          </div>

          <div>
            <Label htmlFor="brand-locale" className="text-xs">
              Locale
            </Label>
            <Input
              id="brand-locale"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              placeholder="en"
              className="font-mono"
            />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="brand-model" className="text-xs">
              Chat model
            </Label>
            <select
              id="brand-model"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Repo default model</option>
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="brand-agent" className="text-xs">
              Agency agent
            </Label>
            <select
              id="brand-agent"
              value={agentSlug}
              onChange={(event) => setAgentSlug(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            >
              <option value="">Kody default agent</option>
              {agentOptions.map((agent) => (
                <option key={agent.slug} value={agent.slug}>
                  {agent.title}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="brand-welcome" className="text-xs">
              Welcome text
            </Label>
            <Textarea
              id="brand-welcome"
              value={welcomeText}
              onChange={(event) => setWelcomeText(event.target.value)}
              rows={4}
              placeholder="How the client chat should greet users."
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              onSave({
                slug,
                name,
                accent,
                locale: locale.trim() || undefined,
                welcomeText: welcomeText.trim() || undefined,
                modelId: modelId.trim() || undefined,
                agentSlug: agentSlug.trim() || undefined,
                isUpdate: !isNew,
              });
            }}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : isNew ? (
              "Create"
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
