/**
 * @fileType component
 * @domain capabilities
 * @pattern capabilities-manager
 * @ai-summary CRUD UI for custom capabilities stored at
 *   `capabilities/<slug>/` in the state repo.
 *   The editor shows name + instructions first, with model/tools/skills/scripts
 *   kept in advanced controls. A validation block checks the generated profile.json before saving.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  Boxes,
  BookOpen,
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  FileCode,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Terminal,
  Trash2,
  User,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { cn } from "../utils";
import { selectionPath } from "../selection-routing";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import { Checkbox } from "@dashboard/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  COMMON_TOOLS,
  composeProfile,
  descriptionFromInstructions,
  isValidSlug,
  serializeProfile,
  slugFromName,
  validateProfile,
  type CapabilityLanding,
  type McpServerSpec,
  type PermissionMode,
} from "../capabilities/profile";
import type { ChatModelEntry } from "../chat/platform/agent-entries";

/** One-line explanation per tool, shown beside its checkbox. */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  Read: "Read files in the repo.",
  Write: "Create new files.",
  Edit: "Modify existing files.",
  Bash: "Run shell commands (build, tests, scripts).",
  Grep: "Search file contents.",
  Glob: "Find files by name or pattern.",
  Agent: "Spawn sub-agents to delegate or parallelize work (advanced).",
  "mcp__kody-verify":
    "Gives the agent a 'verify' tool it can call to re-check its work. It does NOT run verify automatically — the agent decides when to call it. PR-landing already runs verify as its own step.",
};

interface CapabilitySkill {
  name: string;
  body: string;
}
interface CapabilityShellScript {
  name: string;
  content: string;
}
interface CapabilitySummary {
  slug: string;
  describe: string;
  landing: CapabilityLanding;
  updatedAt: string | null;
  htmlUrl: string;
  /** Agent profile field, if present. */
  agent?: string | null;
  source?: "local" | "store";
  readOnly?: boolean;
}
interface CapabilityDetail extends CapabilitySummary {
  /** Engine file is still prompt.md; product concept is "instructions". */
  prompt: string;
  model: string;
  permissionMode: PermissionMode;
  tools: string[];
  skills: CapabilitySkill[];
  shellScripts: CapabilityShellScript[];
  mcpServers: McpServerSpec[];
  profileJson: string;
}

export interface CapabilityQueryScope {
  owner?: string | null;
  repo?: string | null;
  resource?: "capabilities";
}

function capabilityQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
  resource: CapabilityQueryScope["resource"] = "capabilities",
): CapabilityQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
    resource,
  };
}

export const capabilityQueryKeys = {
  all: ["kody-capabilities"] as const,
  list: (scope: CapabilityQueryScope = {}) =>
    [
      "kody-capabilities",
      scope.resource ?? "capabilities",
      scope.owner ?? null,
      scope.repo ?? null,
    ] as const,
  detail: (slug: string | null, scope: CapabilityQueryScope = {}) =>
    [
      "kody-capability",
      scope.resource ?? "capabilities",
      scope.owner ?? null,
      scope.repo ?? null,
      slug,
    ] as const,
};

function capabilityResourceForBasePath(
  _basePath: string,
): CapabilityQueryScope["resource"] {
  return "capabilities";
}

function capabilityApiBaseForResource(
  _resource: CapabilityQueryScope["resource"],
): string {
  return "/api/kody/capabilities";
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

async function listApi(
  headers: Record<string, string>,
  apiBase: string,
): Promise<{ capabilities: CapabilitySummary[] }> {
  const res = await fetch(apiBase, {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    capabilities?: CapabilitySummary[];
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return {
    capabilities: json.capabilities ?? [],
  };
}

async function readApi(
  headers: Record<string, string>,
  slug: string,
  apiBase: string,
): Promise<CapabilityDetail> {
  const res = await fetch(`${apiBase}/${encodeURIComponent(slug)}`, {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    capability?: CapabilityDetail;
    error?: string;
    message?: string;
  };
  const capability = json.capability;
  if (!res.ok || !capability)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  return capability;
}

interface SavePayload {
  slug: string;
  describe: string;
  /** Engine instructions body exposed in the UI as capability instructions. */
  prompt: string;
  model: string;
  permissionMode: PermissionMode;
  tools: string[];
  skills: CapabilitySkill[];
  shellScripts: CapabilityShellScript[];
  mcpServers: McpServerSpec[];
  landing: CapabilityLanding;
  isUpdate: boolean;
}

async function saveApi(
  headers: Record<string, string>,
  payload: SavePayload,
  actorLogin?: string,
  apiBase = "/api/kody/capabilities",
): Promise<void> {
  const { slug, isUpdate, prompt, ...rest } = payload;
  const body = { ...rest, instructions: prompt, actorLogin };
  const url = isUpdate ? `${apiBase}/${encodeURIComponent(slug)}` : apiBase;
  const res = await fetch(url, {
    method: isUpdate ? "PATCH" : "POST",
    headers,
    body: JSON.stringify(isUpdate ? body : { slug, ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
}

async function deleteApi(
  headers: Record<string, string>,
  slug: string,
  apiBase: string,
): Promise<void> {
  const res = await fetch(`${apiBase}/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok)
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
}

export function CapabilitiesManager({
  selectedSlug = null,
  basePath = "/capabilities",
}: {
  selectedSlug?: string | null;
  basePath?: string;
} = {}) {
  return (
    <AuthGuard>
      <CapabilitiesManagerInner
        selectedSlug={selectedSlug}
        basePath={basePath}
      />
    </AuthGuard>
  );
}

/**
 * Standalone editor page for `/capabilities/new` (slug=null) and
 * `/capabilities/<slug>`. Owns the save mutation and returns to the list on
 * save/back via the router — so the browser Back button lands on the list,
 * not wherever you were before opening the dashboard.
 */
export function CapabilityEditorPage({
  slug,
  basePath = "/capabilities",
}: {
  slug: string | null;
  basePath?: string;
}) {
  return (
    <AuthGuard>
      <CapabilityEditorPageInner slug={slug} basePath={basePath} />
    </AuthGuard>
  );
}

function CapabilityEditorPageInner({
  slug,
  basePath,
}: {
  slug: string | null;
  basePath: string;
}) {
  const { auth } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const resource = capabilityResourceForBasePath(basePath);
  const apiBase = capabilityApiBaseForResource(resource);
  const queryScope = capabilityQueryScopeFromAuth(auth, resource);
  const listQueryKey = capabilityQueryKeys.list(queryScope);

  const { data } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listApi(headers, apiBase),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const existingSlugs = new Set((data?.capabilities ?? []).map((e) => e.slug));

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveApi(headers, payload, actorLogin, apiBase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capabilityQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Capability saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  const back = () => router.push(basePath);

  return (
    <PageShell
      title={slug ? `Edit capability ${slug}` : "New capability"}
      icon={Boxes}
      iconClassName="text-amber-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      backHref={basePath}
    >
      <CapabilityEditor
        slug={slug}
        headers={headers}
        apiBase={apiBase}
        queryScope={queryScope}
        existingSlugs={existingSlugs}
        saving={save.isPending}
        onClose={back}
        onSave={async (payload) => {
          await save.mutateAsync(payload);
          back();
        }}
      />
    </PageShell>
  );
}

function CapabilitiesManagerInner({
  selectedSlug = null,
  basePath = "/capabilities",
}: {
  selectedSlug?: string | null;
  basePath?: string;
} = {}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 768px)");
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const resource = capabilityResourceForBasePath(basePath);
  const apiBase = capabilityApiBaseForResource(resource);
  const queryScope = capabilityQueryScopeFromAuth(auth, resource);
  const listQueryKey = capabilityQueryKeys.list(queryScope);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: listQueryKey,
    queryFn: () => listApi(headers, apiBase),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const capabilities = useMemo(() => data?.capabilities ?? [], [data]);
  const capabilitiesLoaded = data !== undefined;

  const remove = useMutation({
    mutationFn: (slug: string) => deleteApi(headers, slug, apiBase),
    onSuccess: (_result, slug) => {
      queryClient.invalidateQueries({ queryKey: capabilityQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      if (selectedSlug === slug) selectCapability(null, true);
      toast.success("Capability removed");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove"),
  });

  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Inline edit: when set to the selected slug, the detail pane swaps from the
  // read-only summary to the editor — no route change, no full-page reload.
  const [editingSlug, setEditingSlug] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return capabilities;
    return capabilities.filter(
      (e) =>
        e.slug.toLowerCase().includes(q) ||
        e.describe.toLowerCase().includes(q),
    );
  }, [capabilities, search]);

  const selected = useMemo(
    () => capabilities.find((e) => e.slug === selectedSlug) ?? null,
    [capabilities, selectedSlug],
  );
  const existingSlugs = useMemo(
    () => new Set(capabilities.map((e) => e.slug)),
    [capabilities],
  );
  const deletingAction = useMemo(
    () => capabilities.find((e) => e.slug === deleting) ?? null,
    [capabilities, deleting],
  );

  // Picking a different row exits edit mode — keeps the inline editor bound
  // to whatever is selected on the left.
  useEffect(() => {
    if (editingSlug && editingSlug !== selectedSlug) {
      setEditingSlug(null);
    }
  }, [editingSlug, selectedSlug]);

  // Auto-select the first capability on desktop, mirroring the other manager pages.
  useEffect(() => {
    if (isLoading || !capabilitiesLoaded) return;
    if (capabilities.length === 0) {
      if (selectedSlug) router.replace(basePath);
      return;
    }
    if (
      selectedSlug &&
      !capabilities.some((action) => action.slug === selectedSlug)
    ) {
      router.replace(basePath);
      return;
    }
    if (!selectedSlug && autoSelectFirst) {
      router.replace(selectionPath(basePath, capabilities[0].slug));
    }
  }, [
    autoSelectFirst,
    capabilities,
    capabilitiesLoaded,
    basePath,
    isLoading,
    router,
    selectedSlug,
  ]);

  const selectCapability = (slug: string | null, replace = false) => {
    const path = slug ? selectionPath(basePath, slug) : basePath;
    if (replace) router.replace(path);
    else router.push(path);
  };

  // The list query only returns summaries (slug/describe/landing/etc.) — the
  // detail pane needs instructions, model, tools, skills, scripts, MCP servers to
  // actually show "the capability content", so load the full record for the
  // selected slug and refetch on selection change.
  const selectedFull = useQuery({
    queryKey: capabilityQueryKeys.detail(selected?.slug ?? null, queryScope),
    queryFn: () => readApi(headers, selected!.slug, apiBase),
    enabled: !!selected,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (payload: SavePayload) =>
      saveApi(headers, payload, actorLogin, apiBase),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: capabilityQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      queryClient.invalidateQueries({
        queryKey: capabilityQueryKeys.detail(
          selected?.slug ?? null,
          queryScope,
        ),
      });
      toast.success("Capability saved");
      setEditingSlug(null);
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  return (
    <>
      <MasterDetailShell
        title="Capabilities"
        icon={Boxes}
        iconClassName="text-amber-400"
        subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
        error={
          error
            ? `Couldn't load capabilities: ${error instanceof Error ? error.message : "Unknown error"}`
            : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search capabilities…"
        searchAriaLabel="Search capabilities"
        accent="amber"
        hasSelection={!!selected}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              aria-label="Refresh capabilities"
            >
              <RefreshCw
                className={cn("w-4 h-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              asChild
              size="sm"
              className="w-9 px-0"
              title="New capability"
            >
              <Link href={`${basePath}/new`} aria-label="New capability">
                <Plus className="w-4 h-4" />
              </Link>
            </Button>
          </>
        }
        detail={
          selected ? (
            editingSlug === selected.slug ? (
              <CapabilityInlineEditor
                slug={selected.slug}
                headers={headers}
                apiBase={apiBase}
                queryScope={queryScope}
                existingSlugs={existingSlugs}
                saving={save.isPending}
                onClose={() => setEditingSlug(null)}
                onSave={async (payload) => {
                  await save.mutateAsync(payload);
                }}
              />
            ) : (
              <CapabilityDetail
                exec={selected}
                detail={selectedFull.data ?? null}
                detailLoading={selectedFull.isLoading}
                detailError={
                  selectedFull.error
                    ? selectedFull.error instanceof Error
                      ? selectedFull.error.message
                      : "Failed to load"
                    : null
                }
                onBack={() => selectCapability(null)}
                onEdit={() => {
                  if (!selected.readOnly) setEditingSlug(selected.slug);
                }}
                onDelete={() => {
                  setDeleting(selected.slug);
                }}
              />
            )
          ) : (
            <EmptyState
              icon={<Boxes />}
              title="Select a capability"
              hint="Pick one from the list to see it, edit it, or delete it."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Boxes />} title="Loading capabilities…" />
        ) : capabilities.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="No capabilities yet"
            hint="A capability is stored as capabilities/<slug>/profile.json plus capability.md."
            action={
              <Button asChild size="sm" className="gap-1">
                <Link href={`${basePath}/new`}>
                  <Plus className="w-4 h-4" />
                  New capability
                </Link>
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="No matching capabilities"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((e) => (
              <li key={e.slug}>
                <CapabilityRow
                  exec={e}
                  isActive={selectedSlug === e.slug}
                  onSelect={() => selectCapability(e.slug)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <ConfirmDialog
        open={deleting !== null}
        title={
          deletingAction?.source === "store"
            ? `Remove Store capability ${deleting}?`
            : `Delete capability ${deleting}?`
        }
        description={
          deletingAction?.source === "store"
            ? "This repo will stop using the Store capability. The Store asset will not be deleted."
            : "The whole capability folder is removed from the repo."
        }
        confirmLabel={
          remove.isPending
            ? deletingAction?.source === "store"
              ? "Removing…"
              : "Deleting…"
            : deletingAction?.source === "store"
              ? "Remove"
              : "Delete"
        }
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** One capability in the list. */
function CapabilityRow({
  exec: e,
  isActive,
  onSelect,
}: {
  exec: CapabilitySummary;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3 hover:bg-accent/50 transition-colors relative",
        isActive && "bg-accent/70",
      )}
    >
      {isActive ? (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-amber-400" />
      ) : null}
      <div className="flex items-center gap-2">
        <Boxes
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            isActive ? "text-amber-400" : "text-muted-foreground",
          )}
        />
        <span className="font-mono text-sm truncate flex-1 text-white/90">
          {e.slug}
        </span>
        {e.source === "store" ? (
          <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide bg-amber-500/10 text-amber-300 border border-amber-500/20">
            Store
          </span>
        ) : null}
      </div>
      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
        {e.agent ? (
          <span className="inline-flex items-center gap-1">
            <User className="w-3 h-3" />
            {e.agent}
          </span>
        ) : null}
      </div>
    </button>
  );
}

/** Detail pane for one capability — hero + actual content (instructions, model,
 * tools, skills, scripts, MCP servers). Legacy .md capabilities render the hero
 * only and link out to the file on GitHub. */
function CapabilityDetail({
  exec: e,
  detail,
  detailLoading,
  detailError,
  onBack,
  onEdit,
  onDelete,
}: {
  exec: CapabilitySummary;
  detail: CapabilityDetail | null;
  detailLoading: boolean;
  detailError: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-amber-500/[0.06] via-amber-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="md:hidden gap-1 -ml-2 text-muted-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            All capabilities
          </Button>
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono inline-flex items-center gap-3 flex-wrap">
                <span>{e.slug}</span>
                {e.source === "store" ? (
                  <span className="text-[11px] font-sans uppercase tracking-wide bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded">
                    Store
                  </span>
                ) : null}
              </h1>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                {e.agent ? (
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3 h-3" />
                    profile agent: {e.agent}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <User className="w-3 h-3" />
                    no agent
                  </span>
                )}
                {e.updatedAt ? (
                  <>
                    <span>·</span>
                    <span>updated {formatRelative(e.updatedAt)}</span>
                  </>
                ) : null}
                <span>·</span>
                <a
                  href={e.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                  title="Open on GitHub"
                >
                  <ExternalLink className="w-3 h-3" />
                  GitHub
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                disabled={e.readOnly}
                className="w-9 px-0"
                title={
                  e.readOnly
                    ? "Store-linked capabilities are read-only"
                    : "Edit capability"
                }
                aria-label="Edit capability"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDelete}
                className="w-9 px-0 text-red-400"
                title={
                  e.source === "store"
                    ? "Remove Store capability from this repo"
                    : "Delete capability"
                }
                aria-label={
                  e.source === "store"
                    ? "Remove Store capability from this repo"
                    : "Delete capability"
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </header>
        </div>
      </div>

      <CapabilityContentBody
        detail={detail}
        loading={detailLoading}
        error={detailError}
      />
    </article>
  );
}

/** The non-hero body of the detail pane: instructions, model, tools, skills,
 * shell scripts, MCP servers. Skeleton while loading, an explicit error
 * block if the read fails, and an "empty" hint when there is genuinely
 * nothing configured (the file just has a description and instructions). */
function CapabilityContentBody({
  detail,
  loading,
  error,
}: {
  detail: CapabilityDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading capability content…
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3 text-sm text-rose-200">
          Couldn&apos;t load capability content: {error}
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="rounded-lg border border-dashed border-white/[0.1] bg-white/[0.02] p-4 text-sm text-muted-foreground">
          No content to show yet.
        </div>
      </div>
    );
  }

  const userTools = (detail.tools ?? []).filter((t) => !t.startsWith("mcp__"));

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      {/* Instructions — glue that tells the runner which skills/scripts to use. */}
      <ContentSection
        icon={FileCode}
        title="Instructions"
        subtitle="prompt.md — glue for skills, scripts, and output"
        count={detail.prompt ? 1 : 0}
      >
        {detail.prompt ? (
          <pre className="text-xs font-mono leading-relaxed bg-black/40 border border-white/[0.08] rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-white/85">
            {detail.prompt}
          </pre>
        ) : (
          <EmptyHint text="No instructions written yet." />
        )}
      </ContentSection>

      <details className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-white/90">
          Advanced
        </summary>
        <div className="pt-4 space-y-6">
          <ContentSection icon={Cpu} title="Model" subtitle="claudeCode.model">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-white/85 bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1">
                {detail.model || "inherit"}
              </span>
              <span className="text-white/45">·</span>
              <span className="text-white/55">
                {userTools.length} tool{userTools.length === 1 ? "" : "s"}
              </span>
            </div>
          </ContentSection>

          <ContentSection
            icon={Wrench}
            title="Tools"
            subtitle="claudeCode.tools — what the agent may call"
            count={userTools.length}
          >
            {userTools.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {userTools.map((t) => (
                  <span
                    key={t}
                    className="font-mono text-[11px] bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 text-white/80"
                  >
                    {t}
                  </span>
                ))}
              </div>
            ) : (
              <EmptyHint text="No tools allowed — the agent can't read or edit." />
            )}
          </ContentSection>

          <ContentSection
            icon={BookOpen}
            title="Skills"
            subtitle="skills/<name>/SKILL.md — loaded into the agent"
            count={detail.skills.length}
          >
            {detail.skills.length > 0 ? (
              <div className="space-y-2">
                {detail.skills.map((s) => (
                  <Card
                    key={s.name}
                    className="border-white/[0.08] bg-white/[0.02]"
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <div className="font-mono text-xs text-white/85">
                        {s.name}
                      </div>
                      {s.body ? (
                        <pre className="text-[11px] font-mono leading-relaxed text-white/65 whitespace-pre-wrap break-words max-h-48 overflow-auto">
                          {s.body}
                        </pre>
                      ) : (
                        <p className="text-[11px] text-white/40">
                          (empty SKILL.md)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyHint text="No skills attached." />
            )}
          </ContentSection>

          <ContentSection
            icon={Terminal}
            title="Scripts"
            subtitle="*.sh — preflight steps run before the agent"
            count={detail.shellScripts.length}
          >
            {detail.shellScripts.length > 0 ? (
              <div className="space-y-2">
                {detail.shellScripts.map((s) => (
                  <Card
                    key={s.name}
                    className="border-white/[0.08] bg-white/[0.02]"
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <div className="font-mono text-xs text-white/85">
                        {s.name}
                      </div>
                      {s.content ? (
                        <pre className="text-[11px] font-mono leading-relaxed text-white/65 whitespace-pre-wrap break-words max-h-48 overflow-auto">
                          {s.content}
                        </pre>
                      ) : (
                        <p className="text-[11px] text-white/40">
                          (empty script)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyHint text="No preflight scripts." />
            )}
          </ContentSection>

          <ContentSection
            icon={Cpu}
            title="MCP servers"
            subtitle="claudeCode.mcpServers — external tool servers the agent may call"
            count={detail.mcpServers.length}
          >
            {detail.mcpServers.length > 0 ? (
              <div className="space-y-2">
                {detail.mcpServers.map((m) => (
                  <Card
                    key={m.name}
                    className="border-white/[0.08] bg-white/[0.02]"
                  >
                    <CardContent className="p-3 space-y-1.5">
                      <div className="font-mono text-xs text-white/85">
                        {m.name}
                      </div>
                      <div className="text-[11px] font-mono text-white/55 break-words">
                        {m.command}
                        {m.args && m.args.length > 0 ? (
                          <span className="text-white/35">
                            {" "}
                            {m.args.join(" ")}
                          </span>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyHint text="No MCP tool servers." />
            )}
          </ContentSection>
        </div>
      </details>
    </div>
  );
}

function ContentSection({
  icon: Icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-amber-300/80" />
        <h2 className="text-sm font-semibold text-white/90">{title}</h2>
        {typeof count === "number" ? (
          <span className="text-[10px] font-mono text-white/40 bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5">
            {count}
          </span>
        ) : null}
      </div>
      {subtitle ? (
        <p className="text-[11px] text-white/40 font-mono">{subtitle}</p>
      ) : null}
      {children}
    </section>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-white/40 italic">{text}</p>;
}

interface EditorProps {
  slug: string | null;
  headers: Record<string, string>;
  apiBase: string;
  queryScope: CapabilityQueryScope;
  existingSlugs: Set<string>;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
  /** Render the form's built-in title + Back row. Off when the form is
   *  embedded in a wrapper that provides its own header (inline edit). */
  showHeader?: boolean;
}

const DEFAULT_INSTRUCTIONS = `# Instructions

Use the configured skills, tools, and scripts.

Return the required final result.
`;

function CapabilityEditor({
  slug,
  headers,
  apiBase,
  queryScope,
  existingSlugs,
  saving,
  onClose,
  onSave,
  showHeader = true,
}: EditorProps) {
  const isNew = slug === null;
  const detail = useQuery({
    queryKey: capabilityQueryKeys.detail(slug, queryScope),
    queryFn: () => readApi(headers, slug as string, apiBase),
    enabled: !isNew,
  });

  if (!isNew && detail.isLoading) {
    return (
      <p className="text-sm text-white/60 flex items-center gap-2 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <CapabilityEditorForm
      isNew={isNew}
      initial={detail.data ?? null}
      existingSlugs={existingSlugs}
      saving={saving}
      headers={headers}
      apiBase={apiBase}
      onClose={onClose}
      onSave={onSave}
      showHeader={showHeader}
    />
  );
}

/** The editor framed for the detail pane — same article + gradient hero as
 *  the read-only card so swapping read-only → edit doesn't change the
 *  card's silhouette. Hero carries a Cancel button; the form's own header
 *  is suppressed (it would duplicate the slug) and the form's bottom
 *  Cancel/Update row stays. */
function CapabilityInlineEditor({
  slug,
  headers,
  apiBase,
  queryScope,
  existingSlugs,
  saving,
  onClose,
  onSave,
}: EditorProps) {
  return (
    <article className="min-h-full">
      <div className="border-b border-white/[0.06] bg-gradient-to-b from-amber-500/[0.06] via-amber-500/[0.02] to-transparent">
        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <header className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight break-words font-mono">
                {slug}
              </h1>
              <p className="text-xs text-muted-foreground">
                Editing inline — Cancel reverts, Update commits to the repo.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={saving}
              className="gap-1"
              aria-label="Cancel edit"
            >
              <X className="w-4 h-4" />
              Cancel
            </Button>
          </header>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <CapabilityEditor
          slug={slug}
          headers={headers}
          apiBase={apiBase}
          queryScope={queryScope}
          existingSlugs={existingSlugs}
          saving={saving}
          onClose={onClose}
          onSave={onSave}
          showHeader={false}
        />
      </div>
    </article>
  );
}

function CapabilityEditorForm({
  isNew,
  initial,
  existingSlugs,
  saving,
  headers,
  apiBase,
  onClose,
  onSave,
  showHeader = true,
}: {
  isNew: boolean;
  initial: CapabilityDetail | null;
  existingSlugs: Set<string>;
  saving: boolean;
  headers: Record<string, string>;
  apiBase: string;
  onClose: () => void;
  onSave: (payload: SavePayload) => Promise<void>;
  showHeader?: boolean;
}) {
  const [name, setName] = useState(initial?.slug ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const isReadOnly = initial?.readOnly === true;
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [prompt, setPrompt] = useState(initial?.prompt ?? DEFAULT_INSTRUCTIONS);
  const [model, setModel] = useState(initial?.model ?? "inherit");
  // Not user-tunable: the engine runs headless (no human to approve tool
  // prompts), so "accept edits" is the only workable mode — exposing the
  // others just invites a stuck run. Hardcoded.
  const permissionMode: PermissionMode = "acceptEdits";
  const [tools, setTools] = useState<string[]>(
    initial?.tools ?? ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
  );
  const landing: CapabilityLanding = initial?.landing ?? "pr";
  const [skills, setSkills] = useState<CapabilitySkill[]>(
    initial?.skills ?? [],
  );
  const [shellScripts, setShellScripts] = useState<CapabilityShellScript[]>(
    initial?.shellScripts ?? [],
  );
  const [mcpServers, setMcpServers] = useState<McpServerSpec[]>(
    initial?.mcpServers ?? [],
  );
  const [skillSource, setSkillSource] = useState("");
  const [importing, setImporting] = useState(false);
  const [mcpSource, setMcpSource] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showProfileJson, setShowProfileJson] = useState(false);

  const models = useQuery({
    queryKey: ["kody-capability-models"],
    queryFn: async (): Promise<ChatModelEntry[]> => {
      const res = await fetch("/api/kody/models", {
        headers,
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as {
        models?: ChatModelEntry[];
        error?: string;
        message?: string;
      };
      if (!res.ok)
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      return Array.isArray(json.models) ? json.models : [];
    },
    staleTime: 30_000,
  });

  const modelOptions = useMemo(
    () => (models.data ?? []).filter((entry) => entry.enabled !== false),
    [models.data],
  );
  const hasSavedCustomModel =
    model !== "inherit" && !modelOptions.some((entry) => entry.id === model);

  // Analyze a GitHub repo and pre-fill a tool from it: the user pastes a URL,
  // the server reads the repo's README/package.json and proposes the MCP
  // command/args + an install command. We pre-fill (never auto-save) so the
  // user reviews — especially the install command, which runs in the runner.
  async function analyzeToolFromSource() {
    const source = mcpSource.trim();
    if (!source) return;
    setAnalyzing(true);
    try {
      const res = await fetch(`${apiBase}/analyze-tool`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        proposal?: {
          name: string;
          command: string;
          args: string[];
          installCommand: string;
          isMcpServer: boolean;
          notes: string;
        };
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.proposal)
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      const p = json.proposal;
      setMcpServers((prev) => [
        ...prev.filter((s) => s.name !== p.name),
        {
          name: p.name,
          command: p.command,
          args: p.args.length > 0 ? p.args : undefined,
        },
      ]);
      // Pre-fill the install command as a preflight script so the binary is
      // present at run time (the run breaks otherwise). User reviews it.
      if (p.installCommand.trim()) {
        const fname = `install-${p.name}.sh`;
        const content = `#!/usr/bin/env bash\nset -euo pipefail\n${p.installCommand.trim()}\n`;
        setShellScripts((prev) => [
          ...prev.filter((s) => s.name !== fname),
          { name: fname, content },
        ]);
      }
      setMcpSource("");
      if (!p.isMcpServer)
        toast.warning(
          `${p.name}: repo may not ship an MCP server — review the command. ${p.notes}`.trim(),
        );
      else
        toast.success(
          `Added "${p.name}". Review the command + the install-${p.name}.sh script before saving.`,
        );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analyze failed");
    } finally {
      setAnalyzing(false);
    }
  }

  // Import a skill from a GitHub source (the same source format the `skills`
  // CLI uses, e.g. vercel-labs/agent-skills). Fetches its SKILL.md and adds
  // it as a skill entry; it's committed into skills/<name>/ on save.
  async function importSkillFromSource() {
    const source = skillSource.trim();
    if (!source) return;
    setImporting(true);
    try {
      const res = await fetch(`${apiBase}/import-skill`, {
        method: "POST",
        headers,
        body: JSON.stringify({ source }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        skill?: CapabilitySkill;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.skill)
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      const imported = json.skill;
      setSkills((prev) => [
        ...prev.filter((s) => s.name !== imported.name),
        imported,
      ]);
      setSkillSource("");
      toast.success(`Imported skill "${imported.name}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const slugError = (() => {
    if (!isNew || !touchedSlug) return null;
    if (!slug) return "Required";
    if (!isValidSlug(slug))
      return "Use lowercase letters, digits, dashes, underscores. Start with a letter or digit.";
    if (existingSlugs.has(slug)) return `"${slug}" already exists`;
    return null;
  })();
  const promptError =
    prompt.trim().length === 0 ? "Instructions are required" : null;
  const generatedDescription = descriptionFromInstructions(
    name || slug,
    prompt,
  );

  // Live validation of the profile the form will generate.
  const validation = useMemo(() => {
    const effectiveSlug = isNew ? slug || "draft" : slug;
    const profile = composeProfile({
      slug: effectiveSlug,
      describe: generatedDescription,
      prompt,
      model,
      permissionMode,
      tools,
      skills: skills.map((s) => s.name),
      shellScripts: shellScripts.map((s) => s.name),
      mcpServers,
      landing,
    });
    const errors = validateProfile(profile);
    // Local consistency: skill/sh names must be present and well-formed.
    for (const s of skills)
      if (!s.name.trim()) errors.push("a skill is missing a name");
    for (const s of shellScripts)
      if (!/^[a-zA-Z0-9._-]+\.sh$/.test(s.name))
        errors.push(`shell file "${s.name || "(blank)"}" must be a *.sh name`);
    for (const m of mcpServers) {
      if (!/^[a-zA-Z0-9_-]+$/.test(m.name))
        errors.push(
          `tool name "${m.name || "(blank)"}" must be letters, digits, dash, underscore`,
        );
      if (!m.command.trim())
        errors.push(`tool "${m.name || "(unnamed)"}" is missing a command`);
    }
    return { errors, json: serializeProfile(profile) };
  }, [
    isNew,
    slug,
    generatedDescription,
    prompt,
    model,
    permissionMode,
    tools,
    skills,
    shellScripts,
    mcpServers,
    landing,
  ]);

  // Block save when the composed profile fails the engine invariants or a
  // referenced skill/shell file is malformed — not just slug/instructions.
  const canSave =
    !saving &&
    !isReadOnly &&
    !slugError &&
    !promptError &&
    validation.errors.length === 0 &&
    (isNew ? !!slug : true);

  const toggleTool = (tool: string) =>
    setTools((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
    );

  return (
    <div className="space-y-3">
      {showHeader ? (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white/90">
              {isNew ? "New capability" : `Edit capability ${initial?.slug}`}
            </h2>
            <p className="text-xs text-white/50">
              {isReadOnly
                ? "Store-linked capability. Visible here, edited in kody-store."
                : "Stored at capabilities/<slug>/."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 shrink-0"
            onClick={onClose}
            disabled={saving}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
        </div>
      ) : null}

      <div className="mt-2 space-y-5">
        <section className="space-y-3">
          <div>
            <Label htmlFor="exec-name" className="text-xs">
              Name
            </Label>
            <Input
              id="exec-name"
              value={name}
              onChange={(e) => {
                const next = e.target.value;
                setName(next);
                if (isNew) setSlug(slugFromName(next));
              }}
              onBlur={() => setTouchedSlug(true)}
              disabled={!isNew}
              placeholder="Ship feature"
            />
            <p className="mt-1 text-[11px] text-white/40">
              Saved as{" "}
              <span className="font-mono text-white/60">
                {slug || "new-action"}
              </span>
            </p>
            {slugError && (
              <p className="mt-1 text-xs text-rose-300">{slugError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="exec-instructions" className="text-xs">
              Instructions
            </Label>
            <Textarea
              id="exec-instructions"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="font-mono text-xs"
              rows={16}
            />
            {promptError && (
              <p className="text-xs text-rose-300">{promptError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="exec-model" className="text-xs">
              Model
            </Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="exec-model" className="h-9">
                <SelectValue placeholder="Default model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Default model</SelectItem>
                {hasSavedCustomModel ? (
                  <SelectItem value={model}>{model}</SelectItem>
                ) : null}
                {modelOptions.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {models.isError ? (
              <p className="text-[11px] text-amber-300/80">
                Couldn&apos;t load model list; keeping the saved selection.
              </p>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() =>
                setSkills((prev) => [...prev, { name: "", body: "" }])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add skill
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() =>
                setMcpServers((prev) => [...prev, { name: "", command: "" }])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add MCP
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() =>
                setShellScripts((prev) => [...prev, { name: "", content: "" }])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add script
            </Button>
            <Button
              type="button"
              size="sm"
              variant={showTools ? "secondary" : "outline"}
              className="gap-1"
              onClick={() => setShowTools((open) => !open)}
            >
              <Wrench className="h-3.5 w-3.5" />
              {showTools ? "Hide tools" : "Edit tools"}
            </Button>
          </div>
        </section>

        {showTools ? (
          <section className="space-y-3 rounded-md border border-white/[0.08] bg-white/[0.02] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-white/80">
                  Tool allowlist
                </h3>
                <p className="text-[11px] text-white/40">
                  {tools.length} selected
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {COMMON_TOOLS.map((tool) => (
                <label
                  key={tool}
                  className="flex cursor-pointer items-start gap-2 rounded border border-white/[0.06] bg-black/20 p-2 text-xs text-white/70"
                >
                  <Checkbox
                    checked={tools.includes(tool)}
                    onCheckedChange={() => toggleTool(tool)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono text-white/90">{tool}</span>
                    <span className="text-white/45">
                      {" "}
                      - {TOOL_DESCRIPTIONS[tool] ?? ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {skills.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-white/80">
                Skills ({skills.length})
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  setSkills((prev) => [...prev, { name: "", body: "" }])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add skill
              </Button>
            </div>
            <Card className="border-white/[0.08] bg-white/[0.02]">
              <CardContent className="space-y-1.5 p-3">
                <Label className="text-xs">Import skill</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={skillSource}
                    onChange={(e) => setSkillSource(e.target.value)}
                    placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
                    className="h-8 font-mono text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        importSkillFromSource();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    disabled={importing || !skillSource.trim()}
                    onClick={importSkillFromSource}
                  >
                    {importing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Import
                  </Button>
                </div>
              </CardContent>
            </Card>
            {skills.map((s, i) => (
              <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={s.name}
                      onChange={(e) =>
                        setSkills((prev) =>
                          prev.map((x, xi) =>
                            xi === i
                              ? { ...x, name: e.target.value.toLowerCase() }
                              : x,
                          ),
                        )
                      }
                      placeholder="skill-name"
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-rose-300"
                      onClick={() =>
                        setSkills((prev) => prev.filter((_, xi) => xi !== i))
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    value={s.body}
                    onChange={(e) =>
                      setSkills((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, body: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="---&#10;name: skill-name&#10;description: …&#10;---&#10;&#10;Skill instructions…"
                    className="font-mono text-xs"
                    rows={6}
                  />
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        {mcpServers.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-white/80">
                MCP ({mcpServers.length})
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  setMcpServers((prev) => [...prev, { name: "", command: "" }])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add MCP
              </Button>
            </div>
            <Card className="border-white/[0.08] bg-white/[0.02]">
              <CardContent className="space-y-1.5 p-3">
                <Label className="text-xs">Add MCP from GitHub</Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={mcpSource}
                    onChange={(e) => setMcpSource(e.target.value)}
                    placeholder="https://github.com/colbymchenry/codegraph"
                    className="h-8 font-mono text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        analyzeToolFromSource();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1"
                    disabled={analyzing || !mcpSource.trim()}
                    onClick={analyzeToolFromSource}
                  >
                    {analyzing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    Analyze
                  </Button>
                </div>
              </CardContent>
            </Card>
            {mcpServers.map((m, i) => (
              <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={m.name}
                      onChange={(e) =>
                        setMcpServers((prev) =>
                          prev.map((x, xi) =>
                            xi === i
                              ? { ...x, name: e.target.value.toLowerCase() }
                              : x,
                          ),
                        )
                      }
                      placeholder="mcp-name"
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-rose-300"
                      onClick={() =>
                        setMcpServers((prev) =>
                          prev.filter((_, xi) => xi !== i),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div>
                    <Label className="text-[11px] text-white/50">Command</Label>
                    <Input
                      value={m.command}
                      onChange={(e) =>
                        setMcpServers((prev) =>
                          prev.map((x, xi) =>
                            xi === i ? { ...x, command: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="codegraph"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-white/50">Args</Label>
                    <Input
                      value={(m.args ?? []).join(" ")}
                      onChange={(e) => {
                        const args = e.target.value
                          .split(/\s+/)
                          .filter(Boolean);
                        setMcpServers((prev) =>
                          prev.map((x, xi) =>
                            xi === i
                              ? {
                                  ...x,
                                  args: args.length > 0 ? args : undefined,
                                }
                              : x,
                          ),
                        );
                      }}
                      placeholder="serve --mcp"
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        {shellScripts.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-white/80">
                Scripts ({shellScripts.length})
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() =>
                  setShellScripts((prev) => [
                    ...prev,
                    { name: "", content: "" },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Add script
              </Button>
            </div>
            {shellScripts.map((s, i) => (
              <Card key={i} className="border-white/[0.08] bg-white/[0.02]">
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={s.name}
                      onChange={(e) =>
                        setShellScripts((prev) =>
                          prev.map((x, xi) =>
                            xi === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="setup.sh"
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-rose-300"
                      onClick={() =>
                        setShellScripts((prev) =>
                          prev.filter((_, xi) => xi !== i),
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Textarea
                    value={s.content}
                    onChange={(e) =>
                      setShellScripts((prev) =>
                        prev.map((x, xi) =>
                          xi === i ? { ...x, content: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="#!/usr/bin/env bash&#10;set -euo pipefail&#10;npm install -g some-tool"
                    className="font-mono text-xs"
                    rows={6}
                  />
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        <section className="space-y-3">
          {validation.errors.length > 0 ? (
            <div className="space-y-1 text-sm text-rose-300">
              <p className="flex items-center gap-2">
                <XCircle className="h-4 w-4" /> Problems
              </p>
              <ul className="list-disc pl-6 text-xs text-rose-200/80">
                {validation.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" /> Valid
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 px-0 text-white/60 hover:text-white"
            onClick={() => setShowProfileJson((open) => !open)}
          >
            <FileCode className="h-3.5 w-3.5" />
            {showProfileJson ? "Hide generated JSON" : "Show generated JSON"}
          </Button>
          {showProfileJson ? (
            <pre className="max-h-72 overflow-x-auto rounded border border-white/[0.08] bg-black/40 p-3 font-mono text-[11px]">
              {validation.json}
            </pre>
          ) : null}
        </section>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() => {
            if (!canSave) return;
            onSave({
              slug,
              describe: generatedDescription,
              prompt,
              model,
              permissionMode,
              tools,
              skills,
              shellScripts,
              mcpServers,
              landing,
              isUpdate: !isNew,
            });
          }}
        >
          {saving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              Saving…
            </>
          ) : isNew ? (
            "Create"
          ) : (
            "Update"
          )}
        </Button>
      </div>
    </div>
  );
}
