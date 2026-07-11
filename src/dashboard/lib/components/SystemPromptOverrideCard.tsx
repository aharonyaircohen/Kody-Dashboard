/**
 * @fileType component
 * @domain instructions
 * @pattern system-prompt-override-card
 * @ai-summary Editor card for state repo `system-prompt.md` — the per-repo
 *   BASE system prompt override for engine chat (kody-live). Unlike
 *   instructions.md (layered on top), a non-empty file REPLACES the
 *   engine's built-in prompt, including its tool-usage and grounding
 *   rules. Rendered below the shared InstructionsManager page.
 */
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, Trash2 } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";
import { useAuth, buildAuthHeaders } from "@dashboard/lib/auth-context";

interface SystemPromptResource {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const queryKey = (owner?: string | null, repo?: string | null) =>
  ["kody-system-prompt", owner ?? null, repo ?? null] as const;

async function fetchSystemPrompt(
  headers: Record<string, string>,
): Promise<SystemPromptResource | null> {
  const res = await fetch("/api/kody/system-prompt", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    systemPrompt?: SystemPromptResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.systemPrompt ?? null;
}

async function saveSystemPrompt(
  headers: Record<string, string>,
  body: string,
  sha?: string,
): Promise<SystemPromptResource | null> {
  const res = await fetch("/api/kody/system-prompt", {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ body, sha }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    systemPrompt?: SystemPromptResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.systemPrompt ?? null;
}

export function SystemPromptOverrideCard() {
  const { auth } = useAuth();
  const headers = buildAuthHeaders(auth);
  const queryClient = useQueryClient();
  const key = queryKey(auth?.owner, auth?.repo);

  const { data: file, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchSystemPrompt(headers),
    enabled: Boolean(auth),
  });

  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    setDraft(file?.body ?? "");
  }, [file?.sha, file?.body]);

  const dirty = draft !== (file?.body ?? "");

  const mutation = useMutation({
    mutationFn: (body: string) => saveSystemPrompt(headers, body, file?.sha),
    onSuccess: (saved) => {
      queryClient.setQueryData(key, saved);
      toast.success(
        saved
          ? "Base prompt override saved — engine chat now uses it instead of the built-in prompt."
          : "Override removed — engine chat is back on the built-in prompt.",
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save the base prompt override");
    },
  });

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="space-y-1">
          <Label htmlFor="system-prompt-override">
            Base system prompt override (engine chat)
          </Label>
          <p className="text-sm text-muted-foreground">
            When this is non-empty, the engine chat (kody-live) uses it{" "}
            <strong>instead of</strong> its built-in base prompt — including
            the built-in tool-usage and grounding rules, so replace those too
            or the agent may misbehave. Leave empty to use the built-in
            prompt. Instructions above are still layered on top either way.
          </p>
        </div>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Textarea
            id="system-prompt-override"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Empty — the engine's built-in system prompt is in use. Paste a full replacement prompt here to override it."
            className="min-h-[240px] font-mono text-sm"
          />
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate(draft)}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1 h-4 w-4" />
            )}
            Save override
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || mutation.isPending}
            onClick={() => setDraft(file?.body ?? "")}
          >
            <RotateCcw className="mr-1 h-4 w-4" /> Revert
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={!file || mutation.isPending}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 className="mr-1 h-4 w-4" /> Remove override
          </Button>
        </div>
        <ConfirmDialog
          open={confirmClear}
          title="Remove the base prompt override?"
          description="Engine chat immediately goes back to the built-in system prompt."
          confirmLabel="Remove"
          variant="destructive"
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            mutation.mutate("");
          }}
        />
      </CardContent>
    </Card>
  );
}
