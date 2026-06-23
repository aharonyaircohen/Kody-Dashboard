/**
 * @fileType component
 * @domain preview
 * @pattern controlled-form
 * @ai-summary Small label + URL form for a named preview environment. Reused by
 *   the env switcher's add/edit rows and by the Preview workspace's empty state
 *   ("add your first environment"). Validates a non-empty name and a preview
 *   URL before calling onSubmit; presentation only — the parent persists.
 */
"use client";

import { useState } from "react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Loader2, Save } from "lucide-react";
import { normalizeEnvUrl } from "../preview-environments";

interface PreviewEnvFormProps {
  initialLabel?: string;
  initialUrl?: string;
  submitLabel?: string;
  isSaving?: boolean;
  onSubmit: (label: string, url: string) => void | Promise<void>;
  onCancel?: () => void;
}

export function PreviewEnvForm({
  initialLabel = "",
  initialUrl = "",
  submitLabel = "Add",
  isSaving = false,
  onSubmit,
  onCancel,
}: PreviewEnvFormProps) {
  const [label, setLabel] = useState(initialLabel);
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError("Name is required");
      return;
    }
    const cleanUrl = normalizeEnvUrl(url);
    if (!cleanUrl) {
      setError("Enter a valid URL");
      return;
    }
    try {
      await onSubmit(cleanLabel, cleanUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Input
        type="text"
        placeholder="Name (e.g. Production)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={isSaving}
        maxLength={48}
        aria-label="Environment name"
      />
      <Input
        type="text"
        inputMode="url"
        placeholder="https://your-app.example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={isSaving}
        aria-label="Environment URL"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isSaving} className="gap-1.5">
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {isSaving ? "Saving…" : submitLabel}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
