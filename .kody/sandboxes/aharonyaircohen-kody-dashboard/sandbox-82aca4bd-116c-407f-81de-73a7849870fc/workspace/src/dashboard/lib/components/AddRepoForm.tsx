/**
 * @fileType component
 * @domain kody
 * @pattern controlled-form
 * @ai-summary GitHub repo + PAT connect form. Shared by two surfaces:
 *   the first-run connect screen (RepoManager, bootstrap mode) and the
 *   header RepoSwitcher's "Add repository" row. Validates the repo input
 *   and token, POSTs `/api/kody/repos/add` (server-side PAT validation +
 *   webhook registration), then pushes the entry into auth-context.
 *   Presentation + the add call only — switching/removing repos lives in
 *   the switcher; the token never leaves this browser.
 */
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { useAuth } from "../auth-context";

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

interface AddRepoFormProps {
  /**
   * First-repo mode. On success the page reloads to `/` so the dashboard
   * mounts with the freshly-bootstrapped auth. When false, the form clears
   * and `onAdded` fires (the switcher closes its popover).
   */
  isBootstrap: boolean;
  /** Called after a successful non-bootstrap add (e.g. close the dropdown). */
  onAdded?: () => void;
}

export function AddRepoForm({ isBootstrap, onAdded }: AddRepoFormProps) {
  const { addRepo } = useAuth();

  const [repoInput, setRepoInput] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onAdded?.();
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
          <code className="bg-muted px-1 rounded">admin:repo_hook</code> scopes.{" "}
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
  );
}
