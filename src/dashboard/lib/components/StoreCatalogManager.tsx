/**
 * @fileType component
 * @domain kody
 * @pattern store-catalog
 * @ai-summary Browse shared Store assets and add them by reference.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  History,
  Layers,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Bot,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@dashboard/ui/button";

import { buildAuthHeaders, useAuth } from "../auth-context";
import { selectionPath } from "../selection-routing";
import { cn } from "../utils";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";

type CatalogKind =
  | "all"
  | "agent"
  | "agentGoal"
  | "agentLoop"
  | "capability"
  | "command";

type CatalogItemKind = Exclude<CatalogKind, "all">;
type CatalogStatus = "active" | "not-active" | "available" | "customized";

interface ActiveGoalConfigObject {
  template: string;
  idPrefix?: string;
  facts?: Record<string, unknown>;
}

type ActiveGoalConfigEntry = string | ActiveGoalConfigObject;

interface StoreCatalogItem {
  slug: string;
  title: string;
  description: string;
  kind: CatalogItemKind;
  status: CatalogStatus;
  active: boolean;
  activatable: boolean;
  source: "store" | "local";
  htmlUrl: string | null;
  action?: string | null;
  agent?: string | null;
  capabilityKind?: string | null;
  schedule?: string | null;
}

interface StoreCatalogResponse {
  items: StoreCatalogItem[];
  activeAgents: string[];
  activeCapabilities: string[];
  activeCommands: string[];
  activeGoals: ActiveGoalConfigEntry[];
}

const KIND_FILTERS: Array<{
  id: CatalogKind;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "all", label: "All", icon: Package },
  { id: "agent", label: "Agents", icon: Users },
  { id: "agentGoal", label: "Goals", icon: Target },
  { id: "agentLoop", label: "Loops", icon: History },
  { id: "capability", label: "Capabilities", icon: Layers },
  { id: "command", label: "Commands", icon: Bot },
];

const KIND_LABEL: Record<CatalogItemKind, string> = {
  agent: "Agent",
  agentGoal: "Goal",
  agentLoop: "Loop",
  capability: "Capability",
  command: "Command",
};

function queryText(item: StoreCatalogItem): string {
  return [
    item.slug,
    item.title,
    item.description,
    KIND_LABEL[item.kind],
    item.status,
    item.action,
    item.agent,
    item.capabilityKind,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function storeCatalogItemKey(item: StoreCatalogItem): string {
  return `${item.kind}:${item.slug}`;
}

function storeCatalogItemPath(item: StoreCatalogItem): string {
  return selectionPath("/store-catalog", item.kind, item.slug);
}

function statusLabel(item: StoreCatalogItem): string {
  if (item.status === "customized") return "Customized";
  if (item.status === "active") return "Active";
  if (item.status === "not-active") return "Not active";
  return "Available";
}

function statusClass(item: StoreCatalogItem): string {
  if (item.status === "customized") {
    return "border-violet-500/25 bg-violet-500/10 text-violet-200";
  }
  if (item.status === "active") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
  }
  if (item.status === "not-active") {
    return "border-white/10 bg-white/[0.04] text-white/55";
  }
  return "border-sky-500/20 bg-sky-500/10 text-sky-200";
}

async function fetchCatalog(
  headers: Record<string, string>,
): Promise<StoreCatalogResponse> {
  const res = await fetch("/api/kody/store-catalog", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    items?: StoreCatalogItem[];
    activeAgents?: string[];
    activeCapabilities?: string[];
    activeCommands?: string[];
    activeGoals?: ActiveGoalConfigEntry[];
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return {
    items: json.items ?? [],
    activeAgents: json.activeAgents ?? [],
    activeCapabilities: json.activeCapabilities ?? [],
    activeCommands: json.activeCommands ?? [],
    activeGoals: json.activeGoals ?? [],
  };
}

async function addCatalogStoreReference(
  headers: Record<string, string>,
  item: StoreCatalogItem,
): Promise<{
  imported: boolean;
  status: "imported" | "already_local";
  path: string;
}> {
  const res = await fetch("/api/kody/store-catalog/import", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      kind: item.kind,
      slug: item.slug,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    imported?: boolean;
    status?: "imported" | "already_local";
    path?: string;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }

  return {
    imported: json.imported === true,
    status: json.status ?? "imported",
    path: json.path ?? "",
  };
}

async function invalidateOperationsQueries(
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["kody-agent"] }),
    queryClient.invalidateQueries({ queryKey: ["kody-capabilities"] }),
    queryClient.invalidateQueries({ queryKey: ["kody-managed-goals"] }),
  ]);
}

export function StoreCatalogManager({
  selectedKey = null,
}: {
  selectedKey?: string | null;
} = {}) {
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const queryKey = [
    "kody-store-catalog",
    auth?.owner ?? null,
    auth?.repo ?? null,
    auth?.storeRepoUrl ?? null,
    auth?.storeRef ?? null,
  ] as const;
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<CatalogKind>("all");

  const catalog = useQuery({
    queryKey,
    queryFn: () => fetchCatalog(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });

  const items = useMemo(() => catalog.data?.items ?? [], [catalog.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      return !q || queryText(item).includes(q);
    });
  }, [items, kind, search]);
  const selected = useMemo(
    () =>
      filtered.find((item) => storeCatalogItemKey(item) === selectedKey) ??
      null,
    [filtered, selectedKey],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedKey) router.replace("/store-catalog");
      return;
    }
    if (
      !selectedKey ||
      !filtered.some((item) => storeCatalogItemKey(item) === selectedKey)
    ) {
      router.replace(storeCatalogItemPath(filtered[0]!));
    }
  }, [filtered, router, selectedKey]);

  const selectCatalogItem = (item: StoreCatalogItem | null) => {
    router.push(item ? storeCatalogItemPath(item) : "/store-catalog");
  };

  const importMutation = useMutation({
    mutationFn: (item: StoreCatalogItem) =>
      addCatalogStoreReference(headers, item),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      await invalidateOperationsQueries(queryClient);
      toast.success("Added from Store");
    },
    onError: (error: Error) => {
      toast.error("Couldn't add store item", {
        description: error.message,
      });
    },
  });

  return (
    <MasterDetailShell
      title="Store Catalog"
      icon={Package}
      iconClassName="text-emerald-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      error={catalog.error ? (catalog.error as Error).message : null}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search store..."
      searchAriaLabel="Search store catalog"
      accent="emerald"
      hasSelection={!!selected}
      listAside={
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist">
          {KIND_FILTERS.map((filter) => {
            const active = filter.id === kind;
            const Icon = filter.icon;
            return (
              <button
                key={filter.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setKind(filter.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                  active
                    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-white/[0.02] text-white/50 hover:text-white/80",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {filter.label}
              </button>
            );
          })}
        </div>
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void catalog.refetch()}
          disabled={catalog.isFetching}
          aria-label="Refresh store catalog"
        >
          <RefreshCw
            className={cn("h-4 w-4", catalog.isFetching && "animate-spin")}
          />
        </Button>
      }
      detail={
        selected ? (
          <CatalogDetail
            item={selected}
            onBack={() => selectCatalogItem(null)}
            onImport={() => importMutation.mutate(selected)}
            importing={importMutation.isPending}
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title="Select catalog item"
            hint="Store items appear here when repo is connected."
          />
        )
      }
    >
      {catalog.isLoading ? (
        <EmptyState icon={<Package />} title="Loading store catalog..." />
      ) : items.length === 0 ? (
        <EmptyState icon={<Package />} title="No store items found" />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Package />} title="No matching store items" />
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((item) => (
            <li key={`${item.kind}:${item.slug}`}>
              <CatalogRow
                item={item}
                selected={
                  selected
                    ? storeCatalogItemKey(selected) ===
                      storeCatalogItemKey(item)
                    : false
                }
                onSelect={() => selectCatalogItem(item)}
              />
            </li>
          ))}
        </ul>
      )}
    </MasterDetailShell>
  );
}

function CatalogRow({
  item,
  selected,
  onSelect,
}: {
  item: StoreCatalogItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon =
    KIND_FILTERS.find((filter) => filter.id === item.kind)?.icon ?? Package;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`store-catalog-row-${item.kind}-${item.slug}`}
      className={cn(
        "relative w-full px-4 py-3 text-left transition-colors hover:bg-accent/50",
        selected && "bg-accent/70",
      )}
    >
      {selected ? (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-emerald-400" />
      ) : null}
      <div className="flex min-w-0 items-center gap-2">
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            selected ? "text-emerald-400" : "text-muted-foreground",
          )}
        />
        <span className="truncate text-sm font-medium text-white/90">
          {item.title || item.slug}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-white/45">
        <span className="font-mono">{item.slug}</span>
        <StatusPill item={item} />
      </div>
      {item.description ? (
        <p className="mt-1 truncate text-xs text-white/50">
          {item.description}
        </p>
      ) : null}
    </button>
  );
}

function CatalogDetail({
  item,
  onBack,
  onImport,
  importing,
}: {
  item: StoreCatalogItem;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
}) {
  const Icon =
    KIND_FILTERS.find((filter) => filter.id === item.kind)?.icon ?? Package;
  const canImport = item.source === "store" && !item.active;

  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-emerald-500/[0.06] via-emerald-500/[0.02] to-transparent">
        <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="gap-1 -ml-2 text-muted-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            Catalog
          </Button>

          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="h-5 w-5 shrink-0 text-emerald-300" />
                <h2 className="truncate text-xl font-semibold text-white">
                  {item.title || item.slug}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
                <span className="font-mono">{item.slug}</span>
                <span>{KIND_LABEL[item.kind]}</span>
                <StatusPill item={item} />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canImport ? (
                <Button
                  size="sm"
                  onClick={onImport}
                  disabled={importing}
                  data-testid={`store-catalog-import-${item.kind}-${item.slug}`}
                  className="gap-1"
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {importing ? "Adding..." : "Add from Store"}
                </Button>
              ) : null}

              {item.htmlUrl ? (
                <Button asChild size="sm" variant="outline" className="gap-1">
                  <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                    Open
                </a>
              </Button>
            ) : null}
          </div>
          </header>

          {item.description ? (
              <p className="max-w-3xl text-sm leading-6 text-white/70">
                {item.description}
              </p>
            ) : null}
          </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-8">
        <InfoRow label="Type" value={KIND_LABEL[item.kind]} />
        <InfoRow label="Status" value={statusLabel(item)} />
        {item.action ? <InfoRow label="Action" value={item.action} /> : null}
        {item.agent ? <InfoRow label="Agent" value={item.agent} /> : null}
        {item.capabilityKind ? (
          <InfoRow label="Kind" value={item.capabilityKind} />
        ) : null}
        {(item.kind === "agentGoal" || item.kind === "agentLoop") &&
        item.schedule ? (
          <InfoRow label="Schedule" value={item.schedule} />
        ) : null}
            </div>
    </article>
  );
}

function StatusPill({ item }: { item: StoreCatalogItem }) {
  const Icon = item.status === "active" ? CheckCircle2 : CircleDot;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        statusClass(item),
      )}
    >
      <Icon className="h-3 w-3" />
      {statusLabel(item)}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm md:grid-cols-[10rem_minmax(0,1fr)]">
      <span className="text-xs uppercase tracking-wide text-white/35">
        {label}
      </span>
      <span className="min-w-0 truncate text-white/80">{value}</span>
    </div>
  );
}
