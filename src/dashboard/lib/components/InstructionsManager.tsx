/**
 * @fileType component
 * @domain instructions
 * @pattern instructions-manager
 * @ai-summary Editor for `.kody/instructions.md` — the per-repo user
 *   instructions appended to every kody-direct chat turn. Single
 *   textarea + a "View base prompt" button that opens a read-only
 *   dialog showing the base agent prompt the overlay sits on top of.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  ExternalLink,
  Loader2,
  RotateCcw,
  Save,
  ScrollText,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Label } from "@dashboard/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dashboard/ui/tabs";
import { Textarea } from "@dashboard/ui/textarea";
import { ConfirmDialog } from "./ConfirmDialog";
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";

interface InstructionsResource {
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const instructionsQueryKey = ["kody-instructions"] as const;
const basePromptQueryKey = ["kody-instructions-base"] as const;
const fullPromptQueryKey = ["kody-instructions-full"] as const;

type PromptView = "base" | "full";

async function fetchInstructions(
  headers: Record<string, string>,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.instructions ?? null;
}

async function fetchPrompt(
  headers: Record<string, string>,
  variant: PromptView,
): Promise<string> {
  const res = await fetch(`/api/kody/instructions/${variant}`, { headers });
  const json = (await res.json().catch(() => ({}))) as {
    prompt?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.prompt ?? "";
}

async function saveInstructions(
  headers: Record<string, string>,
  body: string,
  sha: string | undefined,
  actorLogin: string | undefined,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", {
    method: "PUT",
    headers,
    body: JSON.stringify({ body, sha, actorLogin }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.instructions ?? null;
}

async function deleteInstructions(
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch("/api/kody/instructions", {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function InstructionsManager() {
  return (
    <AuthGuard>
      <InstructionsManagerInner />
    </AuthGuard>
  );
}

function InstructionsManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } =
    useQuery<InstructionsResource | null>({
      queryKey: instructionsQueryKey,
      queryFn: () => fetchInstructions(headers),
      enabled: !!auth,
      staleTime: 30_000,
    });

  const [draft, setDraft] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promptDialog, setPromptDialog] = useState<PromptView | null>(null);
  const dialogOpen = promptDialog !== null;

  const basePromptQuery = useQuery<string>({
    queryKey: basePromptQueryKey,
    queryFn: () => fetchPrompt(headers, "base"),
    enabled: dialogOpen && !!auth,
    staleTime: 5 * 60_000,
  });

  const fullPromptQuery = useQuery<string>({
    queryKey: fullPromptQueryKey,
    queryFn: () => fetchPrompt(headers, "full"),
    enabled: dialogOpen && !!auth,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data) setDraft(data.body);
    else if (data === null) setDraft("");
  }, [data]);

  const dirty = useMemo(() => draft !== (data?.body ?? ""), [draft, data]);

  const save = useMutation({
    mutationFn: () => saveInstructions(headers, draft, data?.sha, actorLogin),
    onSuccess: (res) => {
      queryClient.setQueryData(instructionsQueryKey, res);
      toast.success("Instructions saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save instructions"),
  });

  const remove = useMutation({
    mutationFn: () => deleteInstructions(headers),
    onSuccess: () => {
      queryClient.setQueryData(instructionsQueryKey, null);
      setDraft("");
      toast.success("Instructions removed");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete instructions"),
  });

  return (
    <PageShell
      title="Instructions"
      icon={ScrollText}
      iconClassName="text-cyan-300"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          {data?.htmlUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link
                href={data.htmlUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View on GitHub"
              >
                <ExternalLink className="w-4 h-4" />
                On GitHub
              </Link>
            </Button>
          )}
          {data && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-rose-300 hover:text-rose-200"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60">
          Free-form markdown appended to every chat turn for the in-process Kody
          agent. Use it to set tone, length, formatting, or behavioral
          preferences for this repo. Stored at{" "}
          <code className="text-white/80">.kody/instructions.md</code>.
        </p>

        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading instructions…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load instructions
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-1"
                onClick={() => refetch()}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && (
          <div className="space-y-2">
            <Label
              htmlFor="instructions-body"
              className="text-sm text-white/70"
            >
              Instructions
            </Label>
            <Textarea
              id="instructions-body"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Default to one-sentence answers. Always cite file paths when referencing code. Prefer Tailwind over inline styles."
              className="min-h-[320px] font-mono text-sm"
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-white/30">
                {data?.updatedAt
                  ? `Last saved ${formatRelative(data.updatedAt)}.`
                  : "Not saved yet."}{" "}
                Hard rules in the base agent prompt (never fake tool calls,
                research before evaluating) still win over your instructions.
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 shrink-0 text-white/60 hover:text-white/90"
                onClick={() => setPromptDialog("base")}
              >
                <Eye className="w-3.5 h-3.5" />
                View system prompt
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove instructions?"
        description="The .kody/instructions.md file will be deleted from the repo. Chat falls back to the base agent prompt only."
        confirmLabel={remove.isPending ? "Removing…" : "Remove"}
        variant="destructive"
        onConfirm={() => {
          remove.mutate();
          setConfirmDelete(false);
        }}
        onClose={() => setConfirmDelete(false)}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) =>
          setPromptDialog(open ? (promptDialog ?? "base") : null)
        }
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              System prompt
            </DialogTitle>
            <DialogDescription>
              Read-only. <strong>Base</strong> is the static agent prompt your
              instructions are layered on top of. <strong>Full</strong> is what
              actually gets sent to the model on a neutral turn — base + repo
              block + memory index + your instructions (no task / job / vibe /
              voice overlay; those only exist mid-chat).
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={promptDialog ?? "base"}
            onValueChange={(v) => setPromptDialog(v as PromptView)}
            className="mt-2"
          >
            <TabsList>
              <TabsTrigger value="base">Base</TabsTrigger>
              <TabsTrigger value="full">Full assembled</TabsTrigger>
            </TabsList>
            <TabsContent value="base" className="mt-3">
              <PromptPane
                isLoading={basePromptQuery.isLoading}
                error={basePromptQuery.error}
                data={basePromptQuery.data}
                fallbackError="Failed to load base prompt"
              />
            </TabsContent>
            <TabsContent value="full" className="mt-3">
              <PromptPane
                isLoading={fullPromptQuery.isLoading}
                error={fullPromptQuery.error}
                data={fullPromptQuery.data}
                fallbackError="Failed to load full prompt"
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

interface PromptPaneProps {
  isLoading: boolean;
  error: unknown;
  data: string | undefined;
  fallbackError: string;
}

function PromptPane({
  isLoading,
  error,
  data,
  fallbackError,
}: PromptPaneProps) {
  if (isLoading) {
    return (
      <p className="text-sm text-white/50 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-rose-300">
        {error instanceof Error ? error.message : fallbackError}
      </p>
    );
  }
  if (!data) return null;
  return (
    <pre className="text-xs text-white/80 bg-black/30 border border-white/10 rounded p-3 max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono">
      {data}
    </pre>
  );
}
