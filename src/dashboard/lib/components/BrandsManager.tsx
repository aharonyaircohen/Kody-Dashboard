/**
 * @fileType component
 * @domain client-chat
 * @pattern brands-manager
 * @ai-summary CRUD UI for client brands. Repo brands live at
 *   `brands/<slug>.json` in the state repo; built-ins are fallback rows that
 *   become repo overrides when edited.
 */
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ExternalLink,
  Globe2,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { ConfirmDialog } from "./ConfirmDialog";
import { Button } from "@dashboard/ui/button";
import { BrandEditor } from "./BrandEditor";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import type {
  BrandRow,
  BrandModelOption,
  BrandsQueryScope,
  SavePayload,
} from "./brands-manager-types";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useAgents } from "../hooks/useAgents";
import { selectionPath } from "../selection-routing";
import { cn } from "../utils";

const brandsQueryKeys = {
  all: ["kody-brands"] as const,
  list: (scope: BrandsQueryScope = {}) =>
    ["kody-brands", scope.owner ?? null, scope.repo ?? null] as const,
};

function queryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): BrandsQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

async function listBrandsApi(
  headers: Record<string, string>,
): Promise<BrandRow[]> {
  const res = await fetch("/api/kody/brands", { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    brands?: BrandRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.brands ?? [];
}

async function listBrandModelsApi(
  headers: Record<string, string>,
): Promise<BrandModelOption[]> {
  const res = await fetch("/api/kody/models", { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    models?: Array<{ id?: string; label?: string; enabled?: boolean }>;
  };
  if (!res.ok || !Array.isArray(json.models)) return [];
  return json.models
    .filter((model) => model.enabled !== false && model.id)
    .map((model) => ({
      id: model.id!,
      label: model.label || model.id!,
    }));
}

async function saveBrandApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
): Promise<void> {
  const { slug, isUpdate, ...rest } = payload;
  const url = isUpdate
    ? `/api/kody/brands/${encodeURIComponent(slug)}`
    : "/api/kody/brands";
  const method = isUpdate ? "PATCH" : "POST";
  const body = JSON.stringify(
    isUpdate ? { ...rest, actorLogin } : { slug, ...rest, actorLogin },
  );
  const res = await fetch(url, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deleteBrandApi(
  headers: Record<string, string>,
  slug: string,
  actorLogin?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (actorLogin) params.set("actorLogin", actorLogin);
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(
    `/api/kody/brands/${encodeURIComponent(slug)}${suffix}`,
    { method: "DELETE", headers },
  );
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

function brandSurfacePath(slug: string): string {
  return `/client/${slug}`;
}

function sourceLabel(source: BrandRow["source"]): string {
  return source === "repo" ? "Repo brand" : "Built-in fallback";
}

function brandSearchText(brand: BrandRow): string {
  return [
    brand.slug,
    brand.name,
    brand.accent,
    brand.locale,
    brand.welcomeText,
    brand.modelId,
    brand.agentSlug,
    brand.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function BrandsManager({
  selectedSlug = null,
}: {
  selectedSlug?: string | null;
}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const queryScope = queryScopeFromAuth(auth);
  const listQueryKey = brandsQueryKeys.list(queryScope);
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<BrandRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listBrandsApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const { data: modelOptions = [] } = useQuery<BrandModelOption[]>({
    queryKey: ["kody-brands-model-options", queryScope.owner, queryScope.repo],
    queryFn: () => listBrandModelsApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const { data: agents = [] } = useAgents();
  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        slug: agent.slug,
        title: agent.title || agent.slug,
      })),
    [agents],
  );
  const brands = useMemo(() => data ?? [], [data]);
  const repoBrandCount = brands.filter(
    (brand) => brand.source === "repo",
  ).length;

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveBrandApi(headers, payload, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: brandsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Brand saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save brand"),
  });

  const remove = useMutation({
    mutationFn: (brand: BrandRow) =>
      deleteBrandApi(headers, brand.slug, actorLogin),
    onSuccess: (_data, brand) => {
      queryClient.invalidateQueries({ queryKey: brandsQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Brand deleted");
      setDeleting(null);
      if (selectedSlug === brand.slug) {
        selectBrand(null, true);
      }
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete brand"),
  });

  const [editing, setEditing] = useState<{
    brand: BrandRow | null;
    isNew: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<BrandRow | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((brand) => brandSearchText(brand).includes(q));
  }, [brands, search]);

  const selectedBrand = useMemo(
    () => brands.find((brand) => brand.slug === selectedSlug) ?? null,
    [brands, selectedSlug],
  );

  useEffect(() => {
    if (isLoading || !data) return;
    if (filtered.length === 0) {
      if (selectedSlug) router.replace("/brands");
      return;
    }
    if (selectedSlug && !filtered.some((brand) => brand.slug === selectedSlug)) {
      router.replace("/brands");
      return;
    }
    if (!selectedSlug && autoSelectFirst) {
      router.replace(selectionPath("/brands", filtered[0]!.slug));
    }
  }, [autoSelectFirst, data, filtered, isLoading, router, selectedSlug]);

  const selectBrand = (slug: string | null, replace = false) => {
    const path = slug ? selectionPath("/brands", slug) : "/brands";
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title="Brands"
        icon={Palette}
        iconClassName="text-cyan-300"
        subtitle={
          auth
            ? `${auth.owner}/${auth.repo} · ${repoBrandCount} repo brands`
            : `${brands.length} ${brands.length === 1 ? "brand" : "brands"}`
        }
        error={
          error
            ? `Couldn't load brands: ${error instanceof Error ? error.message : "Unknown error"}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search brands…"
        searchAriaLabel="Search brands"
        accent="sky"
        hasSelection={!!selectedBrand}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              aria-label="Refresh brands"
            >
              <RefreshCw
                className={cn("h-4 w-4", isLoading && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setEditing({ brand: null, isNew: true })}
              title="New brand"
              aria-label="New brand"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedBrand ? (
            <BrandDetail
              brand={selectedBrand}
              onBack={() => selectBrand(null)}
              onEdit={() => setEditing({ brand: selectedBrand, isNew: false })}
              onDelete={() => setDeleting(selectedBrand)}
            />
          ) : (
            <EmptyState
              icon={<Palette />}
              title="Select a brand"
              hint="Pick one from the list to view or edit its public client chat identity."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Palette />} title="Loading brands…" />
        ) : brands.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="No brands yet"
            hint="Add the first public identity for this repo's client chat."
            action={
              <Button
                size="sm"
                onClick={() => setEditing({ brand: null, isNew: true })}
              >
                <Plus className="h-4 w-4" />
                New brand
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Palette />}
            title="No matching brands"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((brand) => (
              <li key={brand.slug}>
                <BrandListRow
                  brand={brand}
                  isActive={selectedSlug === brand.slug}
                  onSelect={() => selectBrand(brand.slug)}
                  onDelete={() => setDeleting(brand)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      {editing && (
        <BrandEditor
          initial={editing.brand}
          isNew={editing.isNew}
          existingSlugs={new Set(brands.map((brand) => brand.slug))}
          modelOptions={modelOptions}
          agentOptions={agentOptions}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={async (payload) => {
            await save.mutateAsync(payload);
            setEditing(null);
            selectBrand(payload.slug, true);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name}?`}
        description="This brand will be removed from this repo's client chat surfaces."
        confirmLabel={remove.isPending ? "Deleting..." : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function BrandListRow({
  brand,
  isActive,
  onSelect,
  onDelete,
}: {
  brand: BrandRow;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "relative flex items-stretch transition-colors hover:bg-white/[0.04]",
        isActive && "bg-cyan-500/10",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-4 py-3 pr-14 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="h-3.5 w-3.5 shrink-0 rounded border border-white/20"
            style={{ backgroundColor: brand.accent }}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium text-white/90">
            {brand.name}
          </span>
          <span className="shrink-0 rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white/55">
            {brand.source}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {brandSurfacePath(brand.slug)}
        </p>
        <p className="mt-1 truncate text-xs text-white/50">
          {brand.accent} · {brand.locale ?? "en"} ·{" "}
          {brand.modelId ?? "default model"}
        </p>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="absolute right-3 top-3 h-8 w-8 px-0 text-red-300 hover:text-red-200"
        title="Delete brand"
        aria-label={`Delete ${brand.name}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function BrandDetail({
  brand,
  onBack,
  onEdit,
  onDelete,
}: {
  brand: BrandRow;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="min-h-full">
      <div className="border-b border-cyan-500/20 bg-cyan-500/[0.04]">
        <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2 gap-1 text-muted-foreground md:hidden"
          >
            <ArrowLeft className="h-4 w-4" />
            All brands
          </Button>

          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-3">
                <span
                  className="h-6 w-6 shrink-0 rounded border border-white/20"
                  style={{ backgroundColor: brand.accent }}
                  aria-hidden="true"
                />
                <h1 className="break-words text-2xl font-semibold tracking-tight text-white/90 md:text-3xl">
                  {brand.name}
                </h1>
                <span className="rounded bg-white/[0.07] px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-white/55">
                  {brand.source}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono">{brand.slug}</span>
                <span>·</span>
                <span>{sourceLabel(brand.source)}</span>
                <span>·</span>
                <span>{brand.locale ?? "en"}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link
                  href={brandSurfacePath(brand.slug)}
                  aria-label={`Open ${brand.name} client surface`}
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="text-red-300 hover:text-red-200"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </header>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-8">
        <BrandDetailSection title="Client surface" icon={<Globe2 />}>
          <div className="grid gap-3 md:grid-cols-2">
            <DetailField
              label="Public URL"
              value={brandSurfacePath(brand.slug)}
            />
            <DetailField label="Slug" value={brand.slug} />
          </div>
        </BrandDetailSection>

        <BrandDetailSection title="Chat defaults" icon={<Sparkles />}>
          <div className="grid gap-3 md:grid-cols-2">
            <DetailField
              label="Model"
              value={brand.modelId ?? "Repo default model"}
            />
            <DetailField
              label="Agency agent"
              value={brand.agentSlug ?? "Kody default agent"}
            />
          </div>
        </BrandDetailSection>

        <BrandDetailSection title="Appearance" icon={<Palette />}>
          <div className="grid gap-3 md:grid-cols-2">
            <DetailField label="Accent" value={brand.accent} />
            <DetailField label="Locale" value={brand.locale ?? "en"} />
          </div>
        </BrandDetailSection>

        <BrandDetailSection title="Welcome" icon={<Sparkles />}>
          <p className="whitespace-pre-wrap text-sm leading-6 text-white/75">
            {brand.welcomeText || "Default client chat welcome"}
          </p>
        </BrandDetailSection>

        <BrandDetailSection title="Source" icon={<ExternalLink />}>
          <p className="break-all text-sm text-white/75">
            {brand.source === "repo"
              ? brand.htmlUrl || "Repo brand file"
              : "Built-in fallback. Editing creates a repo-owned brand file."}
          </p>
        </BrandDetailSection>
      </div>
    </article>
  );
}

function BrandDetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-white/[0.08] bg-white/[0.03] p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-white/80 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-black/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-sm text-white/80">{value}</p>
    </div>
  );
}
