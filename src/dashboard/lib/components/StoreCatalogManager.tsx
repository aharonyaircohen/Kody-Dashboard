/**
 * @fileType component
 * @domain kody
 * @pattern store-catalog
 * @ai-summary Browse store assets and activate store-backed items by reference.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  History,
  Layers,
  Loader2,
  Package,
  Plus,
  PowerOff,
  RefreshCw,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@dashboard/ui/button";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { cn } from "../utils";
import { MasterDetailShell } from "./MasterDetailShell";
import { EmptyState } from "./EmptyState";

type CatalogKind =
  | "all"
  | "agent"
  | "agentGoal"
  | "agentLoop"
  | "agentResponsibility"
  | "agentAction";

type CatalogItemKind = Exclude<CatalogKind, "all">;
type CatalogStatus = "active" | "not-active" | "available" | "customized";

interface ActiveGoalConfigObject {
  template: string;
  every?: string;
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
  agentAction?: string | null;
  capabilityKind?: string | null;
  schedule?: string | null;
}

interface StoreCatalogResponse {
  items: StoreCatalogItem[];
  activeAgents: string[];
  activeAgentActions: string[];
  activeAgentResponsibilities: string[];
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
  { id: "agentResponsibility", label: "Responsibilities", icon: Layers },
  { id: "agentAction", label: "Actions", icon: Boxes },
];

const KIND_LABEL: Record<CatalogItemKind, string> = {
  agent: "Agent",
  agentGoal: "Goal",
  agentLoop: "Loop",
  agentResponsibility: "Responsibility",
  agentAction: "Action",
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
    item.agentAction,
    item.capabilityKind,
    item.schedule,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function itemKey(item: StoreCatalogItem): string {
  return `${item.kind}:${item.slug}`;
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

function goalActivationSlug(entry: ActiveGoalConfigEntry): string {
  return typeof entry === "string" ? entry : entry.template;
}

function updateActiveGoals(
  entries: ActiveGoalConfigEntry[],
  slug: string,
  active: boolean,
): ActiveGoalConfigEntry[] {
  const without = entries.filter((entry) => goalActivationSlug(entry) !== slug);
  return active ? [...without, slug] : without;
}

function updateActiveAgentResponsibilities(
  entries: string[],
  slug: string,
  active: boolean,
): string[] {
  const without = entries.filter((entry) => entry !== slug);
  return active ? [...without, slug] : without;
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
      activeAgentActions?: string[];
      activeAgentResponsibilities?: string[];
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
    activeAgentActions: json.activeAgentActions ?? [],
    activeAgentResponsibilities: json.activeAgentResponsibilities ?? [],
    activeGoals: json.activeGoals ?? [],
  };
}

async function patchConfig(
  headers: Record<string, string>,
  patch: {
    activeAgents?: string[];
    activeAgentActions?: string[];
    activeAgentResponsibilities?: string[];
    activeGoals?: ActiveGoalConfigEntry[];
    actorLogin?: string;
  },
): Promise<void> {
  const res = await fetch("/api/kody/company/config", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(patch),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export function StoreCatalogManager() {
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
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
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
    () => filtered.find((item) => itemKey(item) === selectedSlug) ?? null,
    [filtered, selectedSlug],
  );

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedSlug) setSelectedSlug(null);
      return;
    }
    if (!selectedSlug || !filtered.some((item) => itemKey(item) === selectedSlug)) {
      setSelectedSlug(itemKey(filtered[0]!));
    }
  }, [filtered, selectedSlug]);

  const activation = useMutation({
    mutationFn: async (item: StoreCatalogItem) => {
      if (!catalog.data || !item.activatable) return;
      const nextActive = !item.active;
      if (item.kind === "agent") {
        await patchConfig(headers, {
          activeAgents: updateActiveAgentResponsibilities(
            catalog.data.activeAgents,
            item.slug,
            nextActive,
          ),
          actorLogin: auth?.user.login,
        });
        return;
      }
      if (item.kind === "agentAction") {
        await patchConfig(headers, {
          activeAgentActions: updateActiveAgentResponsibilities(
            catalog.data.activeAgentActions,
            item.slug,
            nextActive,
          ),
          actorLogin: auth?.user.login,
        });
        return;
      }
      if (item.kind === "agentResponsibility") {
        await patchConfig(headers, {
          activeAgentResponsibilities: updateActiveAgentResponsibilities(
            catalog.data.activeAgentResponsibilities,
            item.slug,
            nextActive,
          ),
          actorLogin: auth?.user.login,
        });
        return;
      }
      if (item.kind === "agentGoal" || item.kind === "agentLoop") {
        await patchConfig(headers, {
          activeGoals: updateActiveGoals(
            catalog.data.activeGoals,
            item.slug,
            nextActive,
          ),
          actorLogin: auth?.user.login,
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Catalog selection updated");
    },
    onError: (error: Error) => {
      toast.error("Couldn't update catalog selection", {
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
            onBack={() => setSelectedSlug(null)}
            onToggle={() => activation.mutate(selected)}
            toggling={activation.isPending}
          />
        ) : (
          <EmptyState
            icon={<Package />}
            title="Select a catalog item"
            hint="Store items appear here when a repo is connected."
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
                selected={selected ? itemKey(selected) === itemKey(item) : false}
                onSelect={() => setSelectedSlug(itemKey(item))}
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
  const Icon = KIND_FILTERS.find((filter) => filter.id === item.kind)?.icon ?? Package;
  return (
    <button
      type="button"
      onClick={onSelect}
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
        <p className="mt-1 truncate text-xs text-white/50">{item.description}</p>
      ) : null}
    </button>
  );
}

function CatalogDetail({
  item,
  onBack,
  onToggle,
  toggling,
}: {
  item: StoreCatalogItem;
  onBack: () => void;
  onToggle: () => void;
  toggling: boolean;
}) {
  const Icon = KIND_FILTERS.find((filter) => filter.id === item.kind)?.icon ?? Package;
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
              {item.activatable ? (
                <Button
                  size="sm"
                  variant={item.active ? "outline" : "default"}
                  onClick={onToggle}
                  disabled={toggling}
                  className="gap-1"
                >
                  {toggling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : item.active ? (
                    <PowerOff className="h-4 w-4" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {item.active ? "Deactivate" : "Add to repo"}
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
        {item.agentAction ? (
          <InfoRow label="Agent action" value={item.agentAction} />
        ) : null}
        {item.capabilityKind ? (
          <InfoRow label="Kind" value={item.capabilityKind} />
        ) : null}
        {item.schedule ? <InfoRow label="Schedule" value={item.schedule} /> : null}
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
