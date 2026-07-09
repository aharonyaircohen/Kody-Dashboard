/**
 * @fileType component
 * @domain settings
 * @pattern settings-card
 * @ai-summary Settings → "Default chat" picker. Chooses which chat entry (a
 *   user-managed model OR Fly Brain) loads when chat opens, writing the
 *   per-user, repo-scoped `kody-default-chat-entry` localStorage key that
 *   KodyChat reads on mount. This replaces the old "Set default" star in the
 *   chat dropdown — the default now lives in exactly one place.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquareDot } from "lucide-react";
import { RepoScopedLink } from "./RepoScopedLink";
import { toast } from "sonner";
import { Card, CardContent } from "@dashboard/ui/card";
import { Label } from "@dashboard/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { getStoredAuth } from "../api";
import { useAuth } from "../auth-context";
import {
  buildAgentList,
  type ChatModelEntry,
} from "../chat/platform/agent-entries";
import {
  clearDefaultChatEntry,
  readDefaultChatEntry,
  writeDefaultChatEntry,
} from "../chat/platform/default-entry";

/** Sentinel select value for "no explicit default" (Radix forbids ""). */
const AUTO = "__auto__";

function authHeaders(): Record<string, string> {
  const a = getStoredAuth();
  return a
    ? {
        "x-kody-token": a.token,
        "x-kody-owner": a.owner,
        "x-kody-repo": a.repo,
      }
    : {};
}

export function DefaultChatCard() {
  const { auth } = useAuth();
  const owner = auth?.owner ?? "";
  const repo = auth?.repo ?? "";

  const [models, setModels] = useState<ChatModelEntry[]>([]);
  const [flyConfigured, setFlyConfigured] = useState(false);
  const [brainFlyChatEnabled, setBrainFlyChatEnabled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Re-read the saved key whenever the connected repo changes — the key is
  // repo-scoped, so a default set for repo A must not show under repo B.
  useEffect(() => {
    setSelected(readDefaultChatEntry());
  }, [owner, repo]);

  // Pull the same three signals the chat picker uses to build its list, so
  // the options here match exactly what the dropdown would offer.
  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    if (Object.keys(headers).length === 0) return;

    fetch("/api/kody/models", { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: { models?: ChatModelEntry[] }) => {
        if (!cancelled)
          setModels(Array.isArray(json.models) ? json.models : []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });

    fetch("/api/kody/dashboard-config", { headers })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((json: { config?: { brainFlyChatEnabled?: boolean } }) => {
        if (!cancelled)
          setBrainFlyChatEnabled(json.config?.brainFlyChatEnabled === true);
      })
      .catch(() => {
        if (!cancelled) setBrainFlyChatEnabled(false);
      });

    fetch("/api/kody/secrets/FLY_API_TOKEN/value", { headers })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setFlyConfigured(false);
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { value?: string };
        setFlyConfigured(Boolean(body.value && body.value.trim().length > 0));
      })
      .catch(() => {
        if (!cancelled) setFlyConfigured(false);
      });

    return () => {
      cancelled = true;
    };
  }, [owner, repo]);

  const entries = buildAgentList(
    false,
    flyConfigured,
    brainFlyChatEnabled,
    models,
  );

  const onChange = useCallback((value: string) => {
    if (value === AUTO) {
      clearDefaultChatEntry();
      setSelected(null);
      toast.success("Default chat set to automatic");
      return;
    }
    writeDefaultChatEntry(value);
    setSelected(value);
    toast.success("Default chat updated");
  }, []);

  // A saved key can point at an entry that's no longer offered (model deleted,
  // Brain unconfigured). Surface it so the trigger isn't blank and the user can
  // see — and clear — the stale pick.
  const savedMissing =
    selected !== null && !entries.some((e) => e.key === selected);

  return (
    <Card className="border-white/[0.08] bg-white/[0.03]">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquareDot className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold">Default chat</h2>
        </div>
        <p className="text-xs text-white/50 -mt-2">
          Which assistant loads when you open chat. Pick a chat model or Fly
          Brain; &quot;Automatic&quot; falls back to Kody Live. Saved per repo,
          just for you.
        </p>

        <div className="space-y-2">
          <Label className="text-xs text-white/70">Loads on open</Label>
          <Select value={selected ?? AUTO} onValueChange={onChange}>
            <SelectTrigger className="bg-black/30 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic</SelectItem>
              {entries.map((e) => {
                const Icon = e.icon;
                return (
                  <SelectItem key={e.key} value={e.key}>
                    <span className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                      {e.name}
                    </span>
                  </SelectItem>
                );
              })}
              {savedMissing && (
                <SelectItem value={selected as string}>
                  {`Saved pick (unavailable): ${selected}`}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {entries.length === 0 && (
          <p className="text-xs text-white/40">
            No chat models configured yet. Add one on{" "}
            <RepoScopedLink
              href="/models"
              className="underline hover:text-white/70"
            >
              Chat models
            </RepoScopedLink>{" "}
            or enable Fly Brain on{" "}
            <RepoScopedLink
              href="/runner"
              className="underline hover:text-white/70"
            >
              Fly Runner
            </RepoScopedLink>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}
