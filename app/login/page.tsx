"use client";

import { useState } from "react";
import { Github, Lock, AlertCircle, Loader2 } from "lucide-react";

const TOKEN_URL = "https://github.com/settings/tokens/new?description=Kody+Dashboard&scopes=repo,workflow";

export default function LoginPage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), token: token.trim() }),
      });

      let data: { ok?: boolean; error?: string; owner?: string; repo?: string; user?: unknown };
      try {
        data = await res.json();
      } catch {
        setError("Server returned an unreadable response. Please try again.");
        setLoading(false);
        return;
      }

      if (!res.ok || !data.ok) {
        setError(data?.error ?? `Login failed (${res.status}). Please check your token and repository.`);
        setLoading(false);
        return;
      }

      // Store auth data in localStorage
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: repoUrl.trim(),
          owner: data.owner,
          repo: data.repo,
          token: token.trim(),
          user: data.user,
          loggedInAt: Date.now(),
        }),
      );

      // Force full page reload so React Query cache is cleared and dashboard
      // initializes fresh with the new auth state (no stale cache from login page)
      window.location.href = "/";
    } catch (err) {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Github className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Kody Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect to your GitHub repository
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-card border rounded-xl p-6 space-y-5 shadow-sm"
        >
          {/* Repo URL */}
          <div className="space-y-2">
            <label
              htmlFor="repoUrl"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Repository URL
            </label>
            <input
              id="repoUrl"
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              The GitHub repository where the dashboard and chat workflow live.
            </p>
          </div>

          {/* Token */}
          <div className="space-y-2">
            <label
              htmlFor="token"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              <div className="flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                GitHub Personal Access Token
              </div>
            </label>
            <input
              id="token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">
              Token needs <code className="bg-muted px-1 rounded">repo</code> and{" "}
              <code className="bg-muted px-1 rounded">workflow</code> scopes.{" "}
              <a
                href={TOKEN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Generate one here
              </a>
              .
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !repoUrl || !token}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Connecting…
              </>
            ) : (
              <>
                <Github className="w-4 h-4" />
                Connect to GitHub
              </>
            )}
          </button>
        </form>

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground">
          Your token is stored locally in your browser and never sent to any third party.
          Only the GitHub API and this dashboard use it.
        </p>
      </div>
    </div>
  );
}
