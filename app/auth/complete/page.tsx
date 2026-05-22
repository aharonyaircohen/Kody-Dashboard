"use client";

/**
 * @fileType page
 * @domain kody
 * @pattern auth
 * @ai-summary Lands the GitHub App OAuth redirect: stashes token + identity.
 *
 * The callback route redirects here with the user token + identity in the URL
 * fragment. We move it into sessionStorage (a transient "pending login") and
 * send the user to the repo picker, where they choose which repo to connect —
 * the existing /api/kody/repos/add path then persists everything. The fragment
 * is wiped from the URL so the token doesn't linger in history.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PENDING_OAUTH_KEY,
  type PendingOAuth,
} from "@dashboard/lib/auth/pending-oauth";

export default function AuthCompletePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fragment = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(fragment);
    const token = params.get("token");
    const login = params.get("login");

    if (!token || !login) {
      setError("Sign-in did not return a token. Please try again.");
      return;
    }

    const pending: PendingOAuth = {
      token,
      login,
      id: Number(params.get("id") ?? 0),
      avatar: params.get("avatar") ?? "",
    };
    sessionStorage.setItem(PENDING_OAUTH_KEY, JSON.stringify(pending));

    // Wipe the token from the URL/history, then continue to repo selection.
    window.history.replaceState(null, "", "/auth/complete");
    router.replace("/");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
      {error ?? "Finishing sign-in…"}
    </main>
  );
}
