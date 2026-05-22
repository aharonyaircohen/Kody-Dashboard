/**
 * @fileType component
 * @domain kody
 * @pattern multi-repo-manager
 * @ai-summary CRUD UI for the multi-repo list. Each repo carries its own
 *   GitHub PAT, stored client-side in localStorage (kody_auth.repos[]).
 *   The originally-logged-in repo is marked `isLogin` and cannot be removed
 *   without a full logout.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Github,
  Loader2,
  Lock,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuth, type KodyRepoEntry } from "../auth-context";

const TOKEN_DOC_URL =
  "https://github.com/settings/tokens/new?description=Kody+Dashboard&scopes=repo,workflow,admin:repo_hook";

interface AddRepoResponse {
  ok: boolean;
  owner: string;
  repo: string;
  repository: {
    fullName: string;
    private: boolean;
    defaultBranch: string;
    htmlUrl: string;
  };
  /** Token owner's GitHub identity — used to bootstrap auth on first add. */
  user: {
    login: string;
    avatar_url: string;
    id: number;
  };
  webhook: {
    ok: boolean;
    created?: boolean;
    error?: string;
  };
  error?: string;
  message?: string;
}

/**
 * Parse a `https://github.com/owner/repo[/...]` URL into `{owner, repo}`.
 * Accepts the bare `owner/repo` form too.
 */
function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try URL form first.
  if (trimmed.includes("github.com")) {
    try {
      const u = new URL(trimmed);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const repo = parts[1].replace(/\.git$/, "");
        return { owner: parts[0], repo };
      }
    } catch {
      // fall through
    }
  }

  // Bare `owner/repo`
  const m = trimmed.match(/^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };

  return null;
}

function formatRelative(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function RepoManager() {
  const { auth, addRepo, removeRepo, setCurrentRepo } = useAuth();

  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    index: number;
    entry: KodyRepoEntry;
  } | null>(null);

  // Empty-state mode: when `auth` is null this is the very first repo the user
  // is adding. The list section is skipped and `addRepo` bootstraps the entire
  // kody_auth object from the server response.
  const isBootstrap = !auth;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = parseRepoInput(repoInput);
    if (!parsed) {
      setError(
        "Enter a GitHub URL (https://github.com/owner/repo) or owner/repo",
      );
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("Personal access token is required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/kody/repos/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: parsed.owner,
          repo: parsed.repo,
          token: trimmedToken,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as AddRepoResponse;

      if (!res.ok || !data.ok) {
        setError(data.message || data.error || `Failed (${res.status})`);
        setSubmitting(false);
        return;
      }

      addRepo(
        {
          repoUrl: data.repository.htmlUrl,
          owner: data.repository.fullName.split("/")[0],
          repo: data.repository.fullName.split("/")[1],
          token: trimmedToken,
        },
        data.user,
      );

      setRepoInput("");
      setToken("");
      if (data.webhook.ok) {
        toast.success(`Added ${data.repository.fullName}`, {
          description: data.webhook.created
            ? "Webhook installed for push-based updates."
            : "Webhook already configured.",
        });
      } else {
        toast.success(`Added ${data.repository.fullName}`, {
          description:
            "Repo added, but webhook setup failed — push updates may be delayed (polling still works).",
        });
      }

      // On bootstrap (first repo) reload so the dashboard mounts with the
      // freshly-populated auth and React Query / chat rail spin up cleanly.
      if (isBootstrap) {
        window.location.href = "/";
        return;
      }
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell
      title={isBootstrap ? "Connect a repository" : "Repositories"}
      icon={Github}
      iconClassName="text-white/80"
      width="wide"
    >
      <div className="space-y-6">
        <p className="text-sm text-white/60">
          {isBootstrap
            ? "Welcome. Connect a GitHub repository with a personal access token to start using the dashboard. The token stays in this browser only — nothing is sent to a Kody backend."
            : "Connect additional GitHub repositories to this dashboard. Each repo uses its own personal access token, stored in this browser only. Switching the current repo reloads the dashboard so all data is fresh."}
        </p>

        {/* Repo list — hidden until at least one repo is connected. */}
        {auth && (
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {auth.repos.map((entry, idx) => {
                  const isCurrent = idx === auth.currentRepoIndex;
                  return (
                    <div
                      key={`${entry.owner}/${entry.repo}`}
                      className="px-4 py-3 flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={entry.repoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-sm hover:underline inline-flex items-center gap-1"
                          >
                            {entry.owner}/{entry.repo}
                            <ExternalLink className="w-3 h-3 text-muted-foreground" />
                          </a>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              <CheckCircle2 className="w-3 h-3" />
                              Current
                            </span>
                          )}
                          {entry.isLogin && (
                            <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              <Star className="w-3 h-3" />
                              Login repo
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Added {formatRelative(entry.addedAt)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isCurrent && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentRepo(idx)}
                          >
                            Set current
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={entry.isLogin}
                          title={
                            entry.isLogin
                              ? "Login repo can't be removed — use Logout instead"
                              : "Remove repo"
                          }
                          onClick={() =>
                            setConfirmRemove({ index: idx, entry })
                          }
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Add form */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4" />
              <h2 className="font-semibold text-sm">
                {isBootstrap
                  ? "Connect your first repository"
                  : "Add a repository"}
              </h2>
            </div>
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="repoInput">Repository</Label>
                <Input
                  id="repoInput"
                  type="text"
                  placeholder="https://github.com/owner/repo  or  owner/repo"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="token" className="flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  Personal access token
                </Label>
                <Input
                  id="token"
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Needs <code className="bg-muted px-1 rounded">repo</code>,{" "}
                  <code className="bg-muted px-1 rounded">workflow</code>, and{" "}
                  <code className="bg-muted px-1 rounded">admin:repo_hook</code>{" "}
                  scopes.{" "}
                  <a
                    href={TOKEN_DOC_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Generate one here
                  </a>
                  .
                </p>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
                  {error}
                </div>
              )}

              <Button type="submit" disabled={submitting} className="gap-2">
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validating…
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    {isBootstrap ? "Connect repository" : "Add repository"}
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRemove(null)}
          title={`Remove ${confirmRemove.entry.owner}/${confirmRemove.entry.repo}?`}
          description="The PAT will be deleted from this browser. The repository and webhook on GitHub are not affected."
          confirmLabel="Remove"
          variant="destructive"
          onConfirm={() => {
            const { index } = confirmRemove;
            removeRepo(index);
          }}
        />
      )}
    </PageShell>
  );
}
