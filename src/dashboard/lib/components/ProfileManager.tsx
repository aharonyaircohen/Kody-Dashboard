/**
 * @fileType component
 * @domain profile
 * @pattern profile-manager
 * @ai-summary CRUD UI for company-profile files stored at
 *   `.kody/profile/<slug>.md` in the connected repo. Each file is a
 *   free-form markdown section (slug = section name, e.g. `mission`,
 *   `products`); their concatenated bodies are injected into the
 *   kody-direct chat system prompt so the agent knows what the company
 *   is and does. Mirrors PromptsManager minus frontmatter/built-ins.
 */
"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building, Loader2, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
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

interface ProfileRow {
  slug: string;
  body: string;
  sha: string;
  updatedAt: string;
  htmlUrl: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const profileQueryKey = ["kody-profile"] as const;

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

async function listProfileApi(
  headers: Record<string, string>,
): Promise<ProfileRow[]> {
  const res = await fetch("/api/kody/profile", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    profile?: ProfileRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.profile ?? [];
}

interface SavePayload {
  slug: string;
  body: string;
  isUpdate: boolean;
}

async function saveProfileApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { slug, body, isUpdate } = payload;
  const url = isUpdate
    ? `/api/kody/profile/${encodeURIComponent(slug)}`
    : "/api/kody/profile";
  const method = isUpdate ? "PATCH" : "POST";
  const reqBody = JSON.stringify(
    isUpdate ? { body, actorLogin } : { slug, body, actorLogin },
  );
  const res = await fetch(url, { method, headers, body: reqBody });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deleteProfileApi(
  headers: Record<string, string>,
  slug: string,
): Promise<void> {
  const res = await fetch(`/api/kody/profile/${encodeURIComponent(slug)}`, {
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

export function ProfileManager() {
  return (
    <AuthGuard>
      <ProfileManagerInner />
    </AuthGuard>
  );
}

function ProfileManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ProfileRow[]>({
    queryKey: profileQueryKey,
    queryFn: () => listProfileApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const sections = useMemo(() => data ?? [], [data]);

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveProfileApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success("Profile saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save profile"),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => deleteProfileApi(headers, slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success("Profile section deleted");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete profile"),
  });

  const [editing, setEditing] = useState<{
    section: ProfileRow | null;
    isNew: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) || s.body.toLowerCase().includes(q),
    );
  }, [sections, search]);

  return (
    <PageShell
      title="Company Profile"
      icon={Building}
      iconClassName="text-teal-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <Button
          size="sm"
          onClick={() => setEditing({ section: null, isNew: true })}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New section
        </Button>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading profile…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load profile
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

        {!isLoading && !error && sections.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No profile yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Profile sections describe your company — mission, products,
                customers, tone. Their text is fed to Kody on every chat turn
                so it knows who you are. Stored at{" "}
                <code className="text-white/55">
                  .kody/profile/&lt;slug&gt;.md
                </code>{" "}
                in this repo so they&apos;re git-tracked and team-shareable.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && sections.length > 0 && (
          <ListSearch
            value={search}
            onChange={setSearch}
            placeholder="Search profile…"
            ariaLabel="Search profile"
            accent="teal"
          />
        )}

        {!isLoading &&
          !error &&
          sections.length > 0 &&
          filtered.length === 0 && (
            <p className="text-sm text-white/50 px-1">
              No section matches your search.
            </p>
          )}

        <ul className="space-y-2">
          {filtered.map((s) => (
            <li key={s.slug}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-white/90 truncate">
                      {s.slug}
                    </p>
                    {s.body && (
                      <p className="text-xs text-white/60 mt-1 line-clamp-2">
                        {s.body}
                      </p>
                    )}
                    {s.updatedAt && (
                      <p className="text-[11px] text-white/40 mt-0.5">
                        Updated {formatRelative(s.updatedAt)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => setEditing({ section: s, isNew: false })}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-rose-300 hover:text-rose-200"
                      onClick={() => setDeleting(s.slug)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>

      {editing && (
        <ProfileEditor
          initial={editing.section}
          isNew={editing.isNew}
          existingSlugs={new Set(sections.map((s) => s.slug))}
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
        title={`Delete "${deleting}"?`}
        description="The profile file is removed from the repo and Kody stops seeing this section on the next chat turn."
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

interface ProfileEditorProps {
  initial: ProfileRow | null;
  isNew: boolean;
  saving: boolean;
  existingSlugs: Set<string>;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
}

function ProfileEditor({
  initial,
  isNew,
  saving,
  existingSlugs,
  onClose,
  onSave,
}: ProfileEditorProps) {
  const [slug, setSlug] = useState(initial?.slug ?? "");
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
            {isNew ? "New profile section" : `Edit "${initial?.slug}"`}
          </DialogTitle>
          <DialogDescription>
            Stored at .kody/profile/&lt;slug&gt;.md. The slug is the section
            heading Kody sees (e.g. mission, products, customers); the body is
            plain markdown describing it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label htmlFor="profile-slug" className="text-xs">
              Slug (section name)
            </Label>
            <Input
              id="profile-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              onBlur={() => setTouchedSlug(true)}
              disabled={isUpdate}
              placeholder="mission"
              className="font-mono"
            />
            {slugError && (
              <p className="text-xs text-rose-300 mt-1">{slugError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="profile-body" className="text-xs">
              Body
            </Label>
            <Textarea
              id="profile-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="We build…  Our customers are…  We care about…"
              className="font-mono text-xs"
              rows={10}
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
              onSave({ slug, body, isUpdate });
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
              "Update"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
