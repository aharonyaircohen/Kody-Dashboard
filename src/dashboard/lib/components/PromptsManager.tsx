/**
 * @fileType component
 * @domain prompts
 * @pattern prompts-manager
 * @ai-summary CRUD UI for slash-command prompts stored at
 *   `.kody/prompts/<slug>.md` in the connected repo. Dashboard ships
 *   built-ins (`/plan`, `/review`, `/explain`, `/issue`, `/goal`,
 *   `/analyze`, `/duty`); editing a built-in forks it into the repo so
 *   the repo wins by slug.
 */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BookOpen,
  Bot,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  FileText,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";

interface PromptRow {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
  source: "repo" | "builtin";
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const promptsQueryKey = ["kody-prompts"] as const;

function formatRelative(iso: string): string {
  if (!iso) return "";
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

async function listPromptsApi(
  headers: Record<string, string>,
): Promise<PromptRow[]> {
  const res = await fetch("/api/kody/prompts", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    prompts?: PromptRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.prompts ?? [];
}

interface SavePayload {
  slug: string;
  description: string;
  argumentHint?: string;
  body: string;
  isUpdate: boolean;
}

async function savePromptApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { slug, isUpdate, ...rest } = payload;
  const url = isUpdate
    ? `/api/kody/prompts/${encodeURIComponent(slug)}`
    : "/api/kody/prompts";
  const method = isUpdate ? "PATCH" : "POST";
  const body = JSON.stringify(
    isUpdate ? { ...rest, actorLogin } : { slug, ...rest, actorLogin },
  );
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deletePromptApi(
  headers: Record<string, string>,
  slug: string,
): Promise<void> {
  const res = await fetch(`/api/kody/prompts/${encodeURIComponent(slug)}`, {
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

export function PromptsManager() {
  return (
    <AuthGuard>
      <PromptsManagerInner />
    </AuthGuard>
  );
}

function PromptsManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<PromptRow[]>({
    queryKey: promptsQueryKey,
    queryFn: () => listPromptsApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const prompts = useMemo(() => data ?? [], [data]);

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      savePromptApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptsQueryKey });
      toast.success("Prompt saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save prompt"),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => deletePromptApi(headers, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptsQueryKey });
      toast.success("Prompt deleted");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete prompt"),
  });

  const [editing, setEditing] = useState<{
    prompt: PromptRow | null;
    isNew: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <PageShell
      title="Prompts"
      icon={Bot}
      iconClassName="text-violet-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/prompts/docs" aria-label="Prompts docs">
              <BookOpen className="w-4 h-4" />
              Docs
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => setEditing({ prompt: null, isNew: true })}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            New prompt
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading prompts…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load prompts
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && prompts.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No prompts yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Prompts appear as <code className="text-white/55">/slash</code>{" "}
                commands in chat. Stored at{" "}
                <code className="text-white/55">
                  .kody/prompts/&lt;slug&gt;.md
                </code>{" "}
                in this repo so they&apos;re git-tracked and team-shareable.
              </p>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {prompts.map((p) => (
            <li key={p.slug}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-sm text-white/90 truncate">
                        /{p.slug}
                      </p>
                      {p.argumentHint && (
                        <code className="text-[11px] text-white/40 font-mono">
                          {p.argumentHint}
                        </code>
                      )}
                      {p.source === "builtin" && (
                        <span className="text-[10px] uppercase tracking-wide bg-white/[0.06] text-white/50 px-1.5 py-0.5 rounded">
                          built-in
                        </span>
                      )}
                      {p.source === "repo" && (
                        <span className="text-[10px] uppercase tracking-wide bg-emerald-500/15 text-emerald-300/90 px-1.5 py-0.5 rounded">
                          repo
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <p className="text-xs text-white/60 mt-1 truncate">
                        {p.description}
                      </p>
                    )}
                    {p.updatedAt && (
                      <p className="text-[11px] text-white/40 mt-0.5">
                        Updated {formatRelative(p.updatedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => setEditing({ prompt: p, isNew: false })}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {p.source === "builtin" ? "Fork" : "Edit"}
                    </Button>
                    {p.source === "repo" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-rose-300 hover:text-rose-200"
                        onClick={() => setDeleting(p.slug)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-white/30 pt-4 flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          Built-ins ship with the dashboard. Forking writes a same-slug file to
          <code className="text-white/50 mx-1">.kody/prompts/</code> and takes
          over the slot.
        </p>
      </div>

      {editing && (
        <PromptEditor
          initial={editing.prompt}
          isNew={editing.isNew}
          existingSlugs={new Set(prompts.map((p) => p.slug))}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await save.mutateAsync(payload);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete /${deleting}?`}
        description="The prompt file is removed from the repo. If a built-in exists with the same slug, it takes over again."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface PromptEditorProps {
  initial: PromptRow | null;
  isNew: boolean;
  saving: boolean;
  existingSlugs: Set<string>;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

function PromptEditor({
  initial,
  isNew,
  saving,
  existingSlugs,
  onClose,
  onSave,
}: PromptEditorProps) {
  const isBuiltinFork = !isNew && initial?.source === "builtin";
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [argumentHint, setArgumentHint] = useState(initial?.argumentHint ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [touchedSlug, setTouchedSlug] = useState(false);

  const slugError = (() => {
    if (!isNew) return null;
    if (!touchedSlug) return null;
    if (!slug) return "Required";
    if (!SLUG_RE.test(slug))
      return "Use lowercase letters, digits, dashes, underscores. Start with a letter or digit.";
    if (existingSlugs.has(slug)) return `"${slug}" already exists`;
    return null;
  })();

  const bodyError = body.trim().length === 0 ? "Required" : null;
  const canSave =
    !saving && !slugError && !bodyError && (isNew ? !!slug : true);

  const isUpdate = !isNew;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isNew
              ? "New prompt"
              : isBuiltinFork
                ? `Fork /${initial?.slug}`
                : `Edit /${initial?.slug}`}
          </DialogTitle>
          <DialogDescription>
            {isBuiltinFork
              ? "Saving writes a same-slug file to .kody/prompts/ that overrides the built-in."
              : "Stored at .kody/prompts/<slug>.md. Use $ARGUMENTS for the full input, $0/$1/… for positional tokens."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="prompt-slug" className="text-xs">
              Slug (becomes /slug)
            </Label>
            <Input
              id="prompt-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => setTouchedSlug(true)}
              disabled={isUpdate}
              placeholder="review"
              className="font-mono"
            />
            {slugError && (
              <p className="text-xs text-rose-300 mt-1">{slugError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="prompt-description" className="text-xs">
              Description (shown in slash menu)
            </Label>
            <Input
              id="prompt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Review my uncommitted changes"
            />
          </div>
          <div>
            <Label htmlFor="prompt-arghint" className="text-xs">
              Argument hint (optional)
            </Label>
            <Input
              id="prompt-arghint"
              value={argumentHint}
              onChange={(e) => setArgumentHint(e.target.value)}
              placeholder="<topic>"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="prompt-body" className="text-xs">
              Body
            </Label>
            <Textarea
              id="prompt-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Explain $ARGUMENTS in this codebase…"
              className="font-mono text-xs"
              rows={8}
              autoFocus
            />
            {bodyError && (
              <p className="text-xs text-rose-300 mt-1">{bodyError}</p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
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
                description,
                argumentHint: argumentHint.trim() || undefined,
                body,
                isUpdate,
              });
            }}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                Saving…
              </>
            ) : isNew ? (
              "Create"
            ) : isBuiltinFork ? (
              "Fork"
            ) : (
              "Update"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
