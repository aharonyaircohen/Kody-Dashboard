/**
 * @fileType component
 * @domain commands
 * @pattern commands-manager
 * @ai-summary CRUD UI for repo-local slash commands plus activated Store
 * commands. Repo commands live at `commands/<slug>.md` in the state repo; Store commands
 * are enabled by `company.activeCommands`; Dashboard built-ins are fallback
 * only. Editing a shared command writes a same-slug repo copy so repo wins by
 * slug — UI just says "Edit", fork happens silently.
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
import { ListSearch } from "./ListSearch";
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

interface CommandRow {
  slug: string;
  description: string;
  argumentHint: string;
  body: string;
  source: "repo" | "store" | "builtin";
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface CommandsQueryScope {
  owner?: string | null;
  repo?: string | null;
}

function commandsQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): CommandsQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const commandsQueryKeys = {
  all: ["kody-commands"] as const,
  list: (scope: CommandsQueryScope = {}) =>
    ["kody-commands", scope.owner ?? null, scope.repo ?? null] as const,
};

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

async function listCommandsApi(
  headers: Record<string, string>,
): Promise<CommandRow[]> {
  const res = await fetch("/api/kody/commands", { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    commands?: CommandRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.commands ?? [];
}

interface SavePayload {
  slug: string;
  description: string;
  argumentHint?: string;
  body: string;
  isUpdate: boolean;
}

async function saveCommandApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { slug, isUpdate, ...rest } = payload;
  const url = isUpdate
    ? `/api/kody/commands/${encodeURIComponent(slug)}`
    : "/api/kody/commands";
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

async function deleteCommandApi(
  headers: Record<string, string>,
  slug: string,
  actorLogin?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (actorLogin) params.set("actorLogin", actorLogin);
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(
    `/api/kody/commands/${encodeURIComponent(slug)}${suffix}`,
    {
      method: "DELETE",
      headers,
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export function CommandsManager() {
  return (
    <AuthGuard>
      <CommandsManagerInner />
    </AuthGuard>
  );
}

function CommandsManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const queryScope = commandsQueryScopeFromAuth(auth);
  const listQueryKey = commandsQueryKeys.list(queryScope);

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<CommandRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listCommandsApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const commands = useMemo(() => data ?? [], [data]);

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveCommandApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commandsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Command saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save command"),
  });

  const remove = useMutation({
    mutationFn: (command: CommandRow) =>
      deleteCommandApi(headers, command.slug, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commandsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Command removed");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete command"),
  });

  const [editing, setEditing] = useState<{
    command: CommandRow | null;
    isNew: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<CommandRow | null>(null);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (p) =>
        p.slug.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.argumentHint.toLowerCase().includes(q) ||
        p.body.toLowerCase().includes(q),
    );
  }, [commands, search]);

  return (
    <PageShell
      title="Commands"
      icon={Bot}
      iconClassName="text-violet-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          <Button asChild variant="ghost" size="sm" className="gap-1">
            <Link href="/commands/docs" aria-label="Commands docs">
              <BookOpen className="w-4 h-4" />
              Docs
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => setEditing({ command: null, isNew: true })}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            New command
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading commands…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load commands
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

        {!isLoading && !error && commands.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No commands yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Commands appear as <code className="text-white/55">/slash</code>{" "}
                entries in chat. Stored at{" "}
                <code className="text-white/55">
                  commands/&lt;slug&gt;.md
                </code>{" "}
                in the state repo so they&apos;re git-tracked and team-shareable.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && commands.length > 0 && (
          <ListSearch
            value={search}
            onChange={setSearch}
            placeholder="Search commands…"
            ariaLabel="Search commands"
            accent="violet"
          />
        )}

        {!isLoading &&
          !error &&
          commands.length > 0 &&
          filtered.length === 0 && (
            <p className="text-sm text-white/50 px-1">
              No command matches your search.
            </p>
          )}

        <ul className="space-y-2">
          {filtered.map((p) => (
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
                      {p.source === "store" && (
                        <span className="text-[10px] uppercase tracking-wide bg-sky-500/15 text-sky-300/90 px-1.5 py-0.5 rounded">
                          store
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
                      onClick={() => setEditing({ command: p, isNew: false })}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    {(p.source === "repo" || p.source === "store") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-rose-300 hover:text-rose-200"
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {p.source === "store" ? "Remove" : "Delete"}
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
          Built-ins ship with the dashboard. Editing one saves a same-slug copy
          to <code className="text-white/50 mx-1">commands/</code> in the
          state repo, which then takes over the slot.
        </p>
      </div>

      {editing && (
        <CommandEditor
          initial={editing.command}
          isNew={editing.isNew}
          existingSlugs={new Set(commands.map((p) => p.slug))}
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
        title={`${deleting?.source === "store" ? "Remove" : "Delete"} /${deleting?.slug}?`}
        description={
          deleting?.source === "store"
            ? "The Store command will be removed from this repo's active commands. The Store asset is not deleted."
            : "The command file will be removed from repo. If a Store or fallback command exists with same slug, it can take over again."
        }
        confirmLabel={
          remove.isPending
            ? deleting?.source === "store"
              ? "Removing…"
              : "Deleting…"
            : deleting?.source === "store"
              ? "Remove"
              : "Delete"
        }
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface CommandEditorProps {
  initial: CommandRow | null;
  isNew: boolean;
  saving: boolean;
  existingSlugs: Set<string>;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

function CommandEditor({
  initial,
  isNew,
  saving,
  existingSlugs,
  onClose,
  onSave,
}: CommandEditorProps) {
  const isBuiltinEdit =
    !isNew && (initial?.source === "builtin" || initial?.source === "store");
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? "New command" : `Edit /${initial?.slug}`}
          </DialogTitle>
          <DialogDescription>
            {isBuiltinEdit
              ? "Saving stores your version at commands/<slug>.md in the state repo, which takes over from the shared default."
              : "Stored at commands/<slug>.md in the state repo. Use $ARGUMENTS for the full input, $0/$1/… for positional tokens."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="command-slug" className="text-xs">
              Slug (becomes /slug)
            </Label>
            <Input
              id="command-slug"
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
            <Label htmlFor="command-description" className="text-xs">
              Description (shown in slash menu)
            </Label>
            <Input
              id="command-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Review my uncommitted changes"
            />
          </div>
          <div>
            <Label htmlFor="command-arghint" className="text-xs">
              Argument hint (optional)
            </Label>
            <Input
              id="command-arghint"
              value={argumentHint}
              onChange={(e) => setArgumentHint(e.target.value)}
              placeholder="<topic>"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="command-body" className="text-xs">
              Body
            </Label>
            <Textarea
              id="command-body"
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
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
