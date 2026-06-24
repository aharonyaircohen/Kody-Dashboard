"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ExternalLink,
  GitBranch,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { PageShell } from "./PageShell";
import { RepoManager } from "./RepoManager";
import { useChatScope } from "./ChatRailShell";
import { ConfirmDialog } from "./ConfirmDialog";
import { buildAuthHeaders, useAuth, type KodyRepoEntry } from "../auth-context";

interface OrgRepository {
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  owner: string;
}

interface OrgReposResponse {
  org: string;
  repositories: OrgRepository[];
  error?: string;
  message?: string;
}

interface AttachRepoResponse {
  ok: boolean;
  owner: string;
  repo: string;
  repository: {
    fullName: string;
    private: boolean;
    defaultBranch: string;
    htmlUrl: string;
  };
  user: { login: string; avatar_url: string; id: number };
  webhook: { ok: boolean; created?: boolean; error?: string };
  error?: string;
  message?: string;
}

interface CreateRepoResponse {
  ok: boolean;
  repository: OrgRepository;
  user: { login: string; avatar_url: string; id: number };
  webhook: { ok: boolean; created?: boolean; error?: string };
  error?: string;
  message?: string;
}

function repoKey(owner: string, repo: string) {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

function attachedForOrg(repos: KodyRepoEntry[], org: string) {
  const orgLower = org.toLowerCase();
  return repos.filter((repo) => repo.owner.toLowerCase() === orgLower);
}

export function OrgManager({ org }: { org: string }) {
  const router = useRouter();
  const { auth, addRepo, setCurrentRepo, removeRepo } = useAuth();
  const { setScope } = useChatScope();
  const titleMenuRef = useRef<HTMLDivElement | null>(null);
  const [titleMenuOpen, setTitleMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{
    index: number;
    entry: KodyRepoEntry;
  } | null>(null);
  const [repositories, setRepositories] = useState<OrgRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [newRepoAutoInit, setNewRepoAutoInit] = useState(true);

  const attachedRepos = useMemo(
    () => (auth ? attachedForOrg(auth.repos, org) : []),
    [auth, org],
  );
  const orgOwners = useMemo(
    () =>
      auth?.repos?.length
        ? Array.from(new Set(auth.repos.map((repo) => repo.owner)))
        : [org],
    [auth?.repos, org],
  );
  const attachedKeys = useMemo(
    () => new Set(attachedRepos.map((repo) => repoKey(repo.owner, repo.repo))),
    [attachedRepos],
  );
  const availableRepos = useMemo(
    () =>
      repositories.filter(
        (repo) => !attachedKeys.has(repoKey(repo.owner, repo.name)),
      ),
    [attachedKeys, repositories],
  );

  useEffect(() => {
    if (!titleMenuOpen) return;
    const onDocClick = (event: MouseEvent) => {
      if (!titleMenuRef.current) return;
      if (
        event.target instanceof Node &&
        titleMenuRef.current.contains(event.target)
      ) {
        return;
      }
      setTitleMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTitleMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [titleMenuOpen]);

  useEffect(() => {
    setScope({
      kind: "org",
      org,
      repositories: attachedRepos.map((repo) => ({
        owner: repo.owner,
        repo: repo.repo,
      })),
    });
    return () => setScope(null);
  }, [attachedRepos, org, setScope]);

  const loadRepositories = useCallback(async () => {
    if (!auth) return;
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const res = await fetch(
        `/api/kody/orgs/${encodeURIComponent(org)}/repos`,
        {
          headers: buildAuthHeaders(auth),
          cache: "no-store",
        },
      );
      const data = (await res.json().catch(() => ({}))) as OrgReposResponse;
      if (!res.ok) {
        setRepoError(data.message || data.error || `Failed (${res.status})`);
        return;
      }
      setRepositories(data.repositories ?? []);
    } catch (err) {
      setRepoError(`Network error: ${String(err)}`);
    } finally {
      setLoadingRepos(false);
    }
  }, [auth, org]);

  useEffect(() => {
    void loadRepositories();
  }, [loadRepositories]);

  async function attachRepository(repo: OrgRepository) {
    if (!auth) return;
    try {
      const res = await fetch("/api/kody/repos/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: repo.owner,
          repo: repo.name,
          token: auth.token,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as AttachRepoResponse;
      if (!res.ok || !data.ok) {
        toast.error(data.message || data.error || `Failed (${res.status})`);
        return;
      }
      const owner = data.owner || data.repository.fullName.split("/")[0];
      const repoName = data.repo || data.repository.fullName.split("/")[1];
      if (!owner || !repoName) {
        toast.error("GitHub response did not include repository owner/name.");
        return;
      }
      addRepo(
        {
          repoUrl: data.repository.htmlUrl,
          owner,
          repo: repoName,
          token: auth.token,
        },
        data.user,
      );
      toast.success(`Attached ${data.repository.fullName}`);
    } catch (err) {
      toast.error(`Network error: ${String(err)}`);
    }
  }

  async function createRepository(e: React.FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(
        `/api/kody/orgs/${encodeURIComponent(org)}/repos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildAuthHeaders(auth),
          },
          body: JSON.stringify({
            name: newRepoName.trim(),
            description: newRepoDescription.trim() || undefined,
            private: newRepoPrivate,
            autoInit: newRepoAutoInit,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as CreateRepoResponse;
      if (!res.ok || !data.ok) {
        setCreateError(data.message || data.error || `Failed (${res.status})`);
        return;
      }
      addRepo(
        {
          repoUrl: data.repository.htmlUrl,
          owner: data.repository.owner,
          repo: data.repository.name,
          token: auth.token,
        },
        data.user,
      );
      setNewRepoName("");
      setNewRepoDescription("");
      setNewRepoPrivate(true);
      setNewRepoAutoInit(true);
      setRepositories((current) => {
        const key = repoKey(data.repository.owner, data.repository.name);
        if (current.some((repo) => repoKey(repo.owner, repo.name) === key)) {
          return current;
        }
        return [...current, data.repository].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
      toast.success(`Created ${data.repository.fullName}`, {
        description: data.webhook.ok
          ? "Repository attached to this dashboard."
          : "Repository attached, but webhook setup failed.",
      });
    } catch (err) {
      setCreateError(`Network error: ${String(err)}`);
    } finally {
      setCreating(false);
    }
  }

  if (!auth) return <RepoManager />;

  return (
    <>
      <PageShell
        title={org}
        titleContent={
          <div ref={titleMenuRef} className="relative min-w-0">
            <button
              type="button"
              onClick={() => setTitleMenuOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={titleMenuOpen}
              aria-label="Change organization"
              className="group inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 text-base font-semibold text-foreground transition-colors hover:bg-white/[0.06] md:text-lg"
            >
              <span className="truncate">{org}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
            {titleMenuOpen && (
              <div
                role="listbox"
                aria-label="Organizations"
                className="absolute left-0 top-full z-50 mt-1.5 min-w-[14rem] max-w-[22rem] rounded-md border border-zinc-700 bg-zinc-900 py-1 shadow-lg"
              >
                {orgOwners.map((owner) => {
                  const selected = owner === org;
                  return (
                    <button
                      key={owner}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setTitleMenuOpen(false);
                        if (!selected) {
                          router.push(`/org/${encodeURIComponent(owner)}`);
                        }
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800/70"
                    >
                      <Check
                        className={`h-3.5 w-3.5 shrink-0 ${
                          selected ? "text-emerald-400" : "text-transparent"
                        }`}
                      />
                      <span className="min-w-0 truncate">{owner}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        }
        subtitle="Org workspace"
        icon={Building2}
        iconClassName="text-emerald-300"
        width="full"
        contentClassName="space-y-6"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadRepositories()}
            disabled={loadingRepos}
            className="gap-2"
          >
            {loadingRepos ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh
          </Button>
        }
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="space-y-4">
            <div className="rounded-md border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">
                    Attached repositories
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Repositories Kody manages in this dashboard org.
                  </p>
                </div>
                <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
                  {attachedRepos.length}
                </span>
              </div>
              <div className="divide-y divide-white/10">
                {attachedRepos.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    No repositories attached yet.
                  </p>
                ) : (
                  attachedRepos.map((repo) => {
                    const index = auth.repos.findIndex(
                      (entry) =>
                        repoKey(entry.owner, entry.repo) ===
                        repoKey(repo.owner, repo.repo),
                    );
                    return (
                      <div
                        key={repoKey(repo.owner, repo.repo)}
                        className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-start gap-2">
                            <Github className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 max-w-full break-all text-sm font-medium leading-snug sm:truncate sm:break-normal">
                              {repo.owner}/{repo.repo}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Added {new Date(repo.addedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentRepo(index)}
                            disabled={index < 0}
                            className="gap-2"
                          >
                            <ArrowRight className="h-4 w-4" />
                            Open
                          </Button>
                          <Button asChild variant="ghost" size="icon">
                            <a
                              href={repo.repoUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${repo.owner}/${repo.repo} on GitHub`}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setConfirmRemove({ index, entry: repo })
                            }
                            disabled={index < 0 || repo.isLogin}
                            title={
                              repo.isLogin
                                ? "Login repo can't be removed — use Sign out instead"
                                : `Remove ${repo.owner}/${repo.repo}`
                            }
                            className="gap-2 text-red-300 hover:text-red-200"
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-md border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">Available on GitHub</h2>
                  <p className="text-xs text-muted-foreground">
                    Accessible repositories owned by {org} that are not
                    attached.
                  </p>
                </div>
                <span className="rounded bg-white/10 px-2 py-1 text-xs text-white/70">
                  {availableRepos.length}
                </span>
              </div>
              {repoError ? (
                <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {repoError}
                </div>
              ) : null}
              <div className="divide-y divide-white/10">
                {loadingRepos ? (
                  <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading repositories
                  </div>
                ) : availableRepos.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-muted-foreground">
                    No unattached repositories found.
                  </p>
                ) : (
                  availableRepos.map((repo) => (
                    <div
                      key={repo.fullName}
                      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start gap-2">
                          <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 max-w-full flex-1 break-all text-sm font-medium leading-snug sm:truncate sm:break-normal">
                            {repo.fullName}
                          </span>
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/60">
                            {repo.private ? "Private" : "Public"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Default branch {repo.defaultBranch}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void attachRepository(repo)}
                        className="w-full gap-2 sm:w-auto"
                      >
                        <Plus className="h-4 w-4" />
                        Attach
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <form
              onSubmit={(e) => void createRepository(e)}
              className="rounded-md border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="mb-4">
                <h2 className="text-sm font-semibold">Create repository</h2>
                <p className="text-xs text-muted-foreground">
                  Creates a GitHub repository under {org} and attaches it here.
                </p>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="org-repo-name">Name</Label>
                  <Input
                    id="org-repo-name"
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="new-service"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="org-repo-description">Description</Label>
                  <Input
                    id="org-repo-description"
                    value={newRepoDescription}
                    onChange={(e) => setNewRepoDescription(e.target.value)}
                    placeholder="Optional"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newRepoPrivate}
                    onChange={(e) => setNewRepoPrivate(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black"
                  />
                  Private repository
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newRepoAutoInit}
                    onChange={(e) => setNewRepoAutoInit(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black"
                  />
                  Initialize README
                </label>
                {createError ? (
                  <div className="rounded border border-destructive/20 bg-destructive/10 p-2 text-sm text-destructive">
                    {createError}
                  </div>
                ) : null}
                <Button
                  type="submit"
                  disabled={creating}
                  className="w-full gap-2"
                >
                  {creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Create and attach
                </Button>
              </div>
            </form>
          </aside>
        </div>
      </PageShell>
      {confirmRemove && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRemove(null)}
          title={`Remove ${confirmRemove.entry.owner}/${confirmRemove.entry.repo}?`}
          description="The PAT will be deleted from this browser. Repository and webhook on GitHub are not affected."
          confirmLabel="Remove"
          variant="destructive"
          onConfirm={() => removeRepo(confirmRemove.index)}
        />
      )}
    </>
  );
}
