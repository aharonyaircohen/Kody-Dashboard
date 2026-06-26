/**
 * @fileType component
 * @domain runner
 * @pattern fly-previews-list
 *
 * Dedicated Fly Previews page section. Lists every live preview app with
 * machine-level details and icon actions for opening/copying the public URL,
 * while the general Machines page stays the action surface for all Fly
 * machine types.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Globe, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dashboard/ui/button";

type FlyFeature =
  | "preview"
  | "preview-base"
  | "runner"
  | "brain"
  | "builder"
  | "other";

interface FlyMachineRow {
  feature: FlyFeature;
  app: string;
  machineId: string;
  name?: string;
  state: string;
  region: string;
  label: string;
  sizeLabel: string;
  createdAt?: string;
}

interface Inventory {
  machines: FlyMachineRow[];
  running: number;
  total: number;
}

interface BranchPreviewResponse {
  previews?: Array<{
    branch: string;
    appName?: string;
  }>;
}

interface FlyPreviewsListProps {
  headers: Record<string, string>;
  flyTokenConfigured: boolean;
}

const REFRESH_MS = 15_000;

function previewUrl(app: string): string {
  return `https://${app}.fly.dev`;
}

function repoFromHeaders(headers: Record<string, string>): string | null {
  const owner = headers["x-kody-owner"];
  const repo = headers["x-kody-repo"];
  return owner && repo ? `${owner}/${repo}` : null;
}

function prNumberFromLabel(label: string): number | null {
  const match = label.match(/^PR #(\d+)$/);
  if (!match) return null;
  const pr = Number.parseInt(match[1]!, 10);
  return Number.isFinite(pr) ? pr : null;
}

function previewKind(row: FlyMachineRow): string {
  if (/^PR #\d+$/.test(row.label)) return row.label;
  if (row.label === "static") return "Static";
  if (row.label === "branch") return "Branch";
  return row.label;
}

function statePill(state: string): string {
  if (state === "started" || state === "running")
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (state === "starting" || state === "pending")
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  if (state === "suspended")
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (state === "stopped") return "bg-white/5 text-white/50 border-white/10";
  return "bg-white/5 text-white/40 border-white/10";
}

function formatStarted(iso?: string): string {
  if (!iso) return "-";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "-";
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(machineId: string): string {
  return machineId.length > 12 ? `${machineId.slice(0, 12)}...` : machineId;
}

export function FlyPreviewsList({
  headers,
  flyTokenConfigured,
}: FlyPreviewsListProps) {
  const hasAuth = Object.keys(headers).length > 0;
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [branchNamesByApp, setBranchNamesByApp] = useState<
    Record<string, string>
  >({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const showLoading = options.showLoading ?? true;
      if (!hasAuth || !flyTokenConfigured) {
        setInventory(null);
        setBranchNamesByApp({});
        return;
      }
      if (showLoading) setLoading(true);
      try {
        const [machinesRes, branchesRes] = await Promise.all([
          fetch("/api/kody/fly/machines", { headers }),
          fetch("/api/kody/previews/branch", { headers }),
        ]);
        if (!machinesRes.ok) {
          setInventory(null);
          setBranchNamesByApp({});
          return;
        }
        setInventory((await machinesRes.json()) as Inventory);

        if (branchesRes.ok) {
          const branchBody =
            (await branchesRes.json()) as BranchPreviewResponse;
          setBranchNamesByApp(
            Object.fromEntries(
              (branchBody.previews ?? [])
                .filter((preview) => preview.appName)
                .map((preview) => [preview.appName!, preview.branch]),
            ),
          );
        } else {
          setBranchNamesByApp({});
        }
      } catch {
        setInventory(null);
        setBranchNamesByApp({});
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [hasAuth, flyTokenConfigured, headers],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!hasAuth || !flyTokenConfigured) return;
    const timer = window.setInterval(() => {
      void refresh({ showLoading: false });
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasAuth, flyTokenConfigured, refresh]);

  const previews = useMemo(
    () =>
      (inventory?.machines ?? [])
        .filter((machine) => machine.feature === "preview")
        .sort((a, b) => a.app.localeCompare(b.app)),
    [inventory],
  );

  async function signedPreviewUrl(
    row: FlyMachineRow,
    url: string,
    branchName?: string,
  ): Promise<string> {
    const repo = repoFromHeaders(headers);
    if (!repo) return url;

    const params = new URLSearchParams({ repo });
    const pr = prNumberFromLabel(row.label);
    if (pr) params.set("pr", String(pr));
    else if (branchName) params.set("branch", branchName);
    else return url;

    const res = await fetch(`/api/kody/previews/ticket?${params}`, {
      headers,
    });
    if (!res.ok) return url;
    const body = (await res.json()) as { ticket?: string };
    if (!body.ticket) return url;

    const signed = new URL(url);
    signed.searchParams.set("kp", body.ticket);
    return signed.toString();
  }

  async function copyUrl(row: FlyMachineRow, url: string, branchName?: string) {
    try {
      await navigator.clipboard.writeText(
        await signedPreviewUrl(row, url, branchName),
      );
      toast.success("Preview URL copied");
    } catch {
      toast.error("Copy failed");
    }
  }

  async function openPreview(
    row: FlyMachineRow,
    url: string,
    branchName?: string,
  ) {
    window.open(
      await signedPreviewUrl(row, url, branchName),
      "_blank",
      "noreferrer",
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-semibold">Live previews</h2>
        <span className="text-[11px] text-muted-foreground">
          {previews.length} preview{previews.length === 1 ? "" : "s"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading || !flyTokenConfigured}
          className="ml-auto h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          title="Refresh previews"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
        </Button>
      </div>

      {!flyTokenConfigured && (
        <p className="text-[11px] text-amber-600 italic dark:text-amber-300/80">
          Add FLY_API_TOKEN to the repo Secrets vault to list previews.
        </p>
      )}

      {flyTokenConfigured && !loading && previews.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No preview machines found.
        </p>
      )}

      {previews.length > 0 && (
        <ul
          className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3"
          aria-label="Live preview machines"
        >
          {previews.map((row) => {
            const url = previewUrl(row.app);
            const branchName = branchNamesByApp[row.app];
            const label = branchName
              ? `Branch ${branchName}`
              : previewKind(row);
            return (
              <li
                key={`${row.app}/${row.machineId}`}
                className="min-w-0 rounded-md border border-border bg-card p-3 text-xs text-card-foreground"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className={`max-w-full truncate rounded-full border px-1.5 py-0.5 text-[10px] ${statePill(
                          row.state,
                        )}`}
                      >
                        {row.state}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">
                        {label}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] leading-4 text-muted-foreground">
                      {row.app}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copyUrl(row, url, branchName)}
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      title="Copy preview URL"
                      aria-label="Copy preview URL"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openPreview(row, url, branchName)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sky-300 hover:text-sky-200"
                      title="Open preview"
                      aria-label="Open preview"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </div>
                </div>

                <dl className="mt-3 space-y-2 text-[11px]">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Machine</dt>
                    <dd
                      className="mt-0.5 truncate font-mono text-foreground"
                      title={row.machineId}
                    >
                      {shortId(row.machineId)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Host</dt>
                    <dd className="mt-0.5 truncate text-foreground">
                      {row.app}.fly.dev
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Region</dt>
                    <dd className="mt-0.5 truncate text-foreground">
                      {row.region}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Size</dt>
                    <dd className="mt-0.5 truncate text-foreground">
                      {row.sizeLabel}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Created</dt>
                    <dd className="mt-0.5 truncate text-foreground">
                      {formatStarted(row.createdAt)}
                    </dd>
                  </div>
                  {row.name && (
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Name</dt>
                      <dd className="mt-0.5 truncate text-foreground">
                        {row.name}
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
