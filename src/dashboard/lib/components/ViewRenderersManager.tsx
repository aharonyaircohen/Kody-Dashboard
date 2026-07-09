/**
 * @fileType component
 * @domain view-renderers
 * @pattern state-repo-manager
 * @ai-summary CRUD UI for renderer JSON definitions stored at
 *   `views/renderers/<slug>.json` in the state repo.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ExternalLink,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { AuthGuard } from "../auth-guard";
import { buildAuthHeaders, useAuth } from "../auth-context";
import { slugifyTitle } from "../slug";
import { cn } from "../utils";
import { Button } from "@dashboard/ui/button";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  parseViewRendererDefinitionInput,
  serializeViewRendererDefinition,
  type RendererUiTemplateNode,
} from "@dashboard/lib/view-renderers/definition";
import type {
  RenderedViewAction,
  RenderedViewDataValue,
  RenderedViewUiNode,
} from "@dashboard/lib/chat-ui-actions";

interface RendererRow {
  slug: string;
  name: string;
  description: string;
  purpose: string;
  rule: string;
  data?: Record<
    string,
    {
      description?: string;
      type?: "text" | "markdown" | "actions" | "selection" | "input" | "value";
      optional?: boolean;
    }
  >;
  defaults?: Record<string, unknown>;
  type: "layout";
  ui: unknown;
  source: "repo";
  htmlUrl: string;
  definition: string;
}

type RendererPreviewValue = RenderedViewDataValue;

interface RendererQueryScope {
  owner?: string | null;
  repo?: string | null;
}

const SAMPLE_VALUES: Record<string, string> = {
  title: "Example title",
  body: "Example supporting text.",
};

const DEFAULT_RENDERER_JSON = JSON.stringify(
  {
    slug: "my-renderer",
    name: "My renderer",
    description: "Reusable UI shape.",
    purpose: "decision",
    rule: "Use this purpose when Kody presents a decision that needs one response before continuing.",
    data: {
      title: { description: "Short heading for the decision." },
      body: { description: "The decision question or supporting context." },
      actions: {
        type: "actions",
        description: "The available responses for the user.",
      },
    },
    defaults: {
      actions: [
        {
          id: "continue",
          label: "Continue",
          response: "continue",
          variant: "primary",
        },
        {
          id: "change",
          label: "Change",
          response: "change",
          variant: "secondary",
        },
        {
          id: "stop",
          label: "Stop",
          response: "stop",
          variant: "secondary",
        },
      ],
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", variant: "title", value: "$title" },
        { type: "text", value: "$body" },
        {
          type: "row",
          for: "$actions",
          as: "action",
          item: {
            type: "button",
            label: "$action.label",
            action: "$action",
          },
        },
      ],
    },
  },
  null,
  2,
);

const viewRendererQueryKeys = {
  all: ["view-renderers"] as const,
  list: (scope: RendererQueryScope = {}) =>
    ["view-renderers", scope.owner ?? null, scope.repo ?? null] as const,
};

function parseRendererJson(raw: string): RendererRow | null {
  try {
    const parsed = parseViewRendererDefinitionInput(raw).definition;
    return {
      slug: parsed.slug,
      name: parsed.name,
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      purpose: parsed.purpose,
      rule: typeof parsed.rule === "string" ? parsed.rule : "",
      data: parsed.data ?? {},
      defaults: parsed.defaults ?? {},
      type: "layout",
      ui: parsed.ui,
      source: "repo",
      htmlUrl: "",
      definition: serializeViewRendererDefinition(parsed),
    };
  } catch {
    return null;
  }
}

function isPreviewAction(value: unknown): value is RenderedViewAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  const validVariant =
    action.variant === undefined ||
    action.variant === "primary" ||
    action.variant === "secondary" ||
    action.variant === "danger";
  return (
    typeof action.id === "string" &&
    typeof action.label === "string" &&
    typeof action.response === "string" &&
    validVariant
  );
}

function isPreviewActionList(value: unknown): value is RenderedViewAction[] {
  return Array.isArray(value) && value.every(isPreviewAction);
}

function clonePreviewValue(value: unknown): RendererPreviewValue | undefined {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (isPreviewActionList(value)) {
    return value.map((action) => ({ ...action }));
  }
  return undefined;
}

function buildRendererPreviewData(
  draft: RendererRow,
): Record<string, RendererPreviewValue> {
  const data: Record<string, RendererPreviewValue> = {};
  const defaults = draft.defaults ?? {};
  for (const key of Object.keys(draft.data ?? {})) {
    const defaultValue = clonePreviewValue(defaults[key]);
    if (defaultValue !== undefined) {
      data[key] = defaultValue;
      continue;
    }
    const type = draft.data?.[key]?.type ?? "value";
    if (type === "actions" || type === "selection") {
      data[key] = [];
      continue;
    }
    data[key] = SAMPLE_VALUES[key] ?? `Example ${key}`;
  }
  return data;
}

function previewScopeValue(
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown>,
  root: string,
): unknown {
  if (root === "data") return data;
  if (Object.prototype.hasOwnProperty.call(data, root)) return data[root];
  return locals[root];
}

function resolvePreviewPath(
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  let value = previewScopeValue(data, locals, parts[0]);
  for (const part of parts.slice(1)) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) {
      value = value[Number(part)];
      continue;
    }
    if (typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function resolvePreviewTemplateValue(
  value: string,
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown>,
): unknown {
  const exact = /^\$([a-zA-Z0-9_.-]+)$/.exec(value);
  if (exact) return resolvePreviewPath(data, locals, exact[1]);
  return value.replace(/\$([a-zA-Z0-9_.-]+)/g, (_match, path: string) => {
    const resolved = resolvePreviewPath(data, locals, path);
    return resolved === null || resolved === undefined ? "" : String(resolved);
  });
}

function resolvePreviewTemplateString(
  value: string,
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown>,
): string {
  const resolved = resolvePreviewTemplateValue(value, data, locals);
  if (resolved === null || resolved === undefined) return "";
  if (typeof resolved === "string") return resolved;
  if (typeof resolved === "number" || typeof resolved === "boolean") {
    return String(resolved);
  }
  return "";
}

function actionIdFromLabel(label: string): string {
  return slugifyTitle(label, {
    fallback: "action",
    allowUnderscore: false,
  });
}

function resolvePreviewAction(
  value: string | RenderedViewAction,
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown>,
): RenderedViewAction {
  const resolved =
    typeof value === "string"
      ? resolvePreviewTemplateValue(value, data, locals)
      : value;
  if (isPreviewAction(resolved)) return { ...resolved };
  const label =
    resolved === null || resolved === undefined ? "Submit" : String(resolved);
  const id = actionIdFromLabel(label);
  return { id, label, response: id };
}

function buildRendererPreviewNodes(
  template: RendererUiTemplateNode,
  data: Record<string, RendererPreviewValue>,
  locals: Record<string, unknown> = {},
): RenderedViewUiNode | null {
  if (
    template.type === "stack" ||
    template.type === "row" ||
    template.type === "list"
  ) {
    if (template.for) {
      const value = resolvePreviewTemplateValue(template.for, data, locals);
      if (!Array.isArray(value) || !template.item) {
        return { type: template.type, children: [] };
      }
      const localName = template.as ?? "item";
      return {
        type: template.type,
        children: value
          .map((item, index) =>
            buildRendererPreviewNodes(
              template.item as RendererUiTemplateNode,
              data,
              {
                ...locals,
                [localName]: item,
                index,
              },
            ),
          )
          .filter((node): node is RenderedViewUiNode => Boolean(node)),
      };
    }
    return {
      type: template.type,
      children: (template.children ?? [])
        .map((child) => buildRendererPreviewNodes(child, data, locals))
        .filter((node): node is RenderedViewUiNode => Boolean(node)),
    };
  }
  if (template.type === "text") {
    return {
      type: "text",
      value: resolvePreviewTemplateString(template.value, data, locals),
      ...(template.variant ? { variant: template.variant } : {}),
    };
  }
  if (template.type === "markdown") {
    return {
      type: "markdown",
      value: resolvePreviewTemplateString(template.value, data, locals),
    };
  }
  if (template.type === "input") {
    return {
      type: "input",
      value: resolvePreviewTemplateString(template.value, data, locals),
      ...(template.label
        ? { label: resolvePreviewTemplateString(template.label, data, locals) }
        : {}),
      readOnly: template.readOnly ?? true,
    };
  }
  if (template.type === "button") {
    const action = resolvePreviewAction(template.action, data, locals);
    return {
      type: "button",
      label:
        resolvePreviewTemplateString(template.label, data, locals) ||
        action.label,
      action,
    };
  }
  if (template.type === "checkbox") {
    return {
      type: "checkbox",
      name: template.name,
      value: resolvePreviewTemplateString(template.value, data, locals),
      label: resolvePreviewTemplateString(template.label, data, locals),
    };
  }
  if (template.type === "submit") {
    return {
      type: "submit",
      label:
        resolvePreviewTemplateString(template.label, data, locals) || "Submit",
    };
  }
  return null;
}

async function listRenderersApi(
  headers: Record<string, string>,
): Promise<RendererRow[]> {
  const res = await fetch("/api/kody/view-renderers", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    renderers?: RendererRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.renderers ?? [];
}

async function saveRendererApi(
  headers: Record<string, string>,
  definition: string,
  isNew: boolean,
  actorLogin?: string,
): Promise<RendererRow> {
  const parsed = parseRendererJson(definition);
  if (!parsed) throw new Error("Renderer JSON is invalid.");
  const res = await fetch(
    isNew
      ? "/api/kody/view-renderers"
      : `/api/kody/view-renderers/${encodeURIComponent(parsed.slug)}`,
    {
      method: isNew ? "POST" : "PATCH",
      headers,
      body: JSON.stringify({ definition, actorLogin }),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    renderer?: RendererRow;
    error?: string;
    message?: string;
  };
  if (!res.ok || !json.renderer) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.renderer;
}

async function deleteRendererApi(
  headers: Record<string, string>,
  slug: string,
  actorLogin?: string,
): Promise<void> {
  const params = new URLSearchParams();
  if (actorLogin) params.set("actorLogin", actorLogin);
  const suffix = params.toString() ? `?${params}` : "";
  const res = await fetch(
    `/api/kody/view-renderers/${encodeURIComponent(slug)}${suffix}`,
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

export function ViewRenderersManager({
  initialSlug = null,
}: {
  initialSlug?: string | null;
}) {
  return (
    <AuthGuard>
      <ViewRenderersManagerInner initialSlug={initialSlug} />
    </AuthGuard>
  );
}

function ViewRenderersManagerInner({
  initialSlug,
}: {
  initialSlug: string | null;
}) {
  const router = useRouter();
  const { auth } = useAuth();
  const headers = useMemo<Record<string, string>>(
    () => ({
      "Content-Type": "application/json",
      ...buildAuthHeaders(auth),
    }),
    [auth],
  );
  const queryClient = useQueryClient();
  const queryScope = { owner: auth?.owner ?? null, repo: auth?.repo ?? null };
  const listQueryKey = viewRendererQueryKeys.list(queryScope);
  const actorLogin = auth?.user.login;
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug);
  const [definition, setDefinition] = useState(DEFAULT_RENDERER_JSON);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<RendererRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<RendererRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listRenderersApi(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const renderers = useMemo(() => data ?? [], [data]);
  const selected = selectedSlug
    ? (renderers.find((renderer) => renderer.slug === selectedSlug) ?? null)
    : null;
  const draft = parseRendererJson(definition);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return renderers;
    return renderers.filter((renderer) =>
      [
        renderer.slug,
        renderer.name,
        renderer.description,
        renderer.purpose,
        renderer.rule,
        JSON.stringify(renderer.defaults ?? {}),
        renderer.type,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [renderers, search]);

  useEffect(() => {
    if (isNew || selectedSlug || initialSlug || renderers.length === 0) return;
    const first = renderers[0];
    setSelectedSlug(first.slug);
    setDefinition(first.definition);
  }, [initialSlug, isNew, selectedSlug, renderers]);

  useEffect(() => {
    if (!initialSlug) return;
    setSelectedSlug(initialSlug);
    const selectedRenderer = renderers.find(
      (renderer) => renderer.slug === initialSlug,
    );
    if (selectedRenderer) {
      setDefinition(selectedRenderer.definition);
      setIsNew(false);
    }
  }, [initialSlug, renderers]);

  const save = useMutation({
    mutationFn: () => saveRendererApi(headers, definition, isNew, actorLogin),
    onSuccess: (renderer) => {
      queryClient.invalidateQueries({ queryKey: viewRendererQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      setSelectedSlug(renderer.slug);
      setDefinition(renderer.definition);
      setIsNew(false);
      setEditorOpen(false);
      router.replace(`/views/renderers/${encodeURIComponent(renderer.slug)}`);
      toast.success("Saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save"),
  });

  const remove = useMutation({
    mutationFn: (renderer: RendererRow) =>
      deleteRendererApi(headers, renderer.slug, actorLogin),
    onSuccess: async () => {
      setDeleting(null);
      setSelectedSlug(null);
      setDefinition(DEFAULT_RENDERER_JSON);
      setIsNew(false);
      router.replace("/views/renderers");
      await queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Deleted");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete"),
  });

  function startNew() {
    setSelectedSlug(null);
    setDefinition(DEFAULT_RENDERER_JSON);
    setIsNew(true);
    setEditorOpen(true);
    router.push("/views/renderers");
  }

  function selectRenderer(renderer: RendererRow) {
    setSelectedSlug(renderer.slug);
    setDefinition(renderer.definition);
    setIsNew(false);
    router.push(`/views/renderers/${encodeURIComponent(renderer.slug)}`);
  }

  function editCurrent() {
    if (!selected && !isNew) return;
    setEditorOpen(true);
  }

  const detail =
    draft && (selected || isNew) ? (
      <RendererPreviewDetail
        draft={draft}
        isNew={isNew}
        selected={selected}
        onEdit={editCurrent}
        onDelete={() => selected && setDeleting(selected)}
      />
    ) : (
      <EmptyState
        icon={<LayoutGrid />}
        title="Select a renderer"
        hint="Pick a renderer to preview it."
      />
    );

  return (
    <MasterDetailShell
      title="View Renderers"
      icon={LayoutGrid}
      iconClassName="text-cyan-300"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search renderers..."
      searchAriaLabel="Search view renderers"
      accent="teal"
      hasSelection={isNew || Boolean(selected)}
      detail={detail}
      actions={
        <Button size="sm" className="gap-1" onClick={startNew}>
          <Plus className="h-4 w-4" />
          New renderer
        </Button>
      }
    >
      {isLoading ? (
        <EmptyState
          icon={<Loader2 className="animate-spin" />}
          title="Loading renderers..."
        />
      ) : error ? (
        <EmptyState
          icon={<LayoutGrid />}
          title="Could not load renderers"
          hint={error instanceof Error ? error.message : "Unknown error"}
          action={
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title={renderers.length === 0 ? "No renderers yet" : "No matches"}
          hint={
            renderers.length === 0
              ? "Create the first renderer JSON."
              : "Try another search."
          }
          action={
            renderers.length === 0 ? (
              <Button size="sm" className="gap-1" onClick={startNew}>
                <Plus className="h-4 w-4" />
                New renderer
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((renderer) => {
            const isActive = selectedSlug === renderer.slug && !isNew;
            return (
              <li key={renderer.slug}>
                <button
                  type="button"
                  onClick={() => selectRenderer(renderer)}
                  className={cn(
                    "relative w-full px-4 py-3 text-start transition-colors hover:bg-accent/50",
                    isActive && "bg-accent/70",
                  )}
                >
                  {isActive ? (
                    <span className="absolute inset-y-0 left-0 w-0.5 bg-cyan-300" />
                  ) : null}
                  <div className="flex items-start gap-2">
                    <LayoutGrid className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium text-white/90">
                          {renderer.name}
                        </p>
                        <SourceBadge source={renderer.source} />
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {renderer.slug} · {renderer.purpose} ·{" "}
                        {Object.keys(renderer.data ?? {}).length} data keys
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name}?`}
        description="This removes the renderer JSON from the state repo."
        confirmLabel={remove.isPending ? "Deleting..." : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
      <RendererEditorDialog
        open={editorOpen}
        definition={definition}
        isNew={isNew}
        isSaving={save.isPending}
        onOpenChange={setEditorOpen}
        onChange={setDefinition}
        onSave={() => save.mutate()}
      />
    </MasterDetailShell>
  );
}

function RendererPreviewDetail({
  draft,
  isNew,
  selected,
  onEdit,
  onDelete,
}: {
  draft: RendererRow;
  isNew: boolean;
  selected: RendererRow | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const previewData = buildRendererPreviewData(draft);
  const previewUi = buildRendererPreviewNodes(
    draft.ui as RendererUiTemplateNode,
    previewData,
  );
  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white/90">
            {draft.name}
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {draft.slug} · purpose: {draft.purpose}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!isNew && selected?.htmlUrl ? (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <a href={selected.htmlUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Source
              </a>
            </Button>
          ) : null}
          <Button size="sm" className="gap-1" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {!isNew && selected?.source === "repo" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1 text-rose-300 hover:text-rose-200"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-5 md:px-6">
        <div className="mb-4 max-w-2xl rounded-md border border-cyan-400/15 bg-cyan-950/10 p-4">
          <p className="text-sm font-medium text-white/85">Preview</p>
          <div className="mt-3 rounded-md border border-white/[0.08] bg-black/20 p-4">
            {previewUi ? (
              <RendererPreviewNode node={previewUi} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No preview available.
              </p>
            )}
          </div>
        </div>
        {draft.rule ? (
          <div className="mb-4 max-w-2xl rounded-md border border-white/[0.08] bg-black/20 p-4">
            <p className="text-sm font-medium text-white/85">Rule</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {draft.rule}
            </p>
          </div>
        ) : null}
        {draft.defaults ? (
          <div className="mb-4 max-w-2xl rounded-md border border-white/[0.08] bg-black/20 p-4">
            <p className="text-sm font-medium text-white/85">Defaults</p>
            <pre className="mt-2 overflow-auto text-xs leading-5 text-muted-foreground">
              {JSON.stringify(draft.defaults, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RendererPreviewNode({
  node,
  layout = "row",
}: {
  node: RenderedViewUiNode;
  layout?: "row" | "list";
}) {
  if (node.type === "stack") {
    return (
      <div className="space-y-3">
        {node.children.map((child, index) => (
          <RendererPreviewNode key={index} node={child} />
        ))}
      </div>
    );
  }
  if (node.type === "row" || node.type === "list") {
    if (node.children.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">No actions configured.</p>
      );
    }
    const className =
      node.type === "row" ? "flex flex-wrap gap-2" : "space-y-1.5";
    return (
      <div className={className}>
        {node.children.map((child, index) => (
          <RendererPreviewNode
            key={index}
            node={child}
            layout={node.type === "list" ? "list" : "row"}
          />
        ))}
      </div>
    );
  }
  if (node.type === "text") {
    if (node.variant === "title") {
      return (
        <h3 className="text-base font-semibold leading-6 text-white/90">
          {node.value}
        </h3>
      );
    }
    if (node.variant === "label") {
      return (
        <p className="text-xs font-medium text-muted-foreground">
          {node.value}
        </p>
      );
    }
    return (
      <p className="text-sm leading-6 text-muted-foreground">{node.value}</p>
    );
  }
  if (node.type === "markdown") {
    return (
      <MarkdownPreview
        content={node.value}
        className="chat-message-text break-words text-[15px] leading-7 prose-p:my-2 prose-li:my-1"
      />
    );
  }
  if (node.type === "input") {
    return (
      <label className="block space-y-1">
        {node.label ? (
          <span className="text-xs font-medium text-muted-foreground">
            {node.label}
          </span>
        ) : null}
        <input
          value={node.value}
          readOnly={node.readOnly ?? true}
          className="h-8 w-full rounded-md border border-white/[0.08] bg-black/20 px-2 text-sm text-white/90"
        />
      </label>
    );
  }
  if (node.type === "button") {
    const tone =
      node.action.variant === "primary"
        ? "border-cyan-400/30 bg-cyan-400/15 text-cyan-100"
        : node.action.variant === "danger"
          ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
          : "border-white/[0.08] bg-white/[0.04] text-white/85";
    const className =
      layout === "list"
        ? `flex w-full items-center rounded-md border px-3 py-2 text-left text-sm ${tone}`
        : `inline-flex h-8 items-center rounded-md border px-2.5 text-sm ${tone}`;
    return (
      <button type="button" className={className}>
        {node.label}
      </button>
    );
  }
  if (node.type === "checkbox") {
    return (
      <label className="flex w-full items-center gap-3 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/85">
        <input type="checkbox" readOnly className="h-4 w-4" />
        <span>{node.label}</span>
      </label>
    );
  }
  if (node.type === "submit") {
    return (
      <button
        type="button"
        className="inline-flex h-8 items-center rounded-md border border-cyan-400/30 bg-cyan-400/15 px-2.5 text-sm text-cyan-100"
      >
        {node.label}
      </button>
    );
  }
  return null;
}

function RendererEditorDialog({
  open,
  definition,
  isNew,
  isSaving,
  onOpenChange,
  onChange,
  onSave,
}: {
  open: boolean;
  definition: string;
  isNew: boolean;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const isValid = Boolean(parseRendererJson(definition));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{isNew ? "New renderer" : "Edit renderer"}</DialogTitle>
          <DialogDescription>
            Edit the JSON that defines this renderer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <Label htmlFor="renderer-json-modal">Renderer JSON</Label>
          <Textarea
            id="renderer-json-modal"
            value={definition}
            onChange={(event) => onChange(event.target.value)}
            className="min-h-[58vh] font-mono text-xs leading-5"
            spellCheck={false}
          />
          {!isValid ? (
            <p className="text-xs text-rose-300">
              JSON must include slug, name, type "layout", and either ui or
              legacy blocks.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="gap-1"
            disabled={!isValid || isSaving}
            onClick={onSave}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceBadge({ source }: { source: RendererRow["source"] }) {
  return (
    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-300">
      {source}
    </span>
  );
}
