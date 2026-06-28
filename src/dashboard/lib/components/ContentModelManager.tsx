"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { cn } from "@dashboard/lib/utils";
import { Badge } from "@dashboard/ui/badge";
import { Button } from "@dashboard/ui/button";
import { Checkbox } from "@dashboard/ui/checkbox";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@dashboard/ui/select";
import { Textarea } from "@dashboard/ui/textarea";

import { ConfirmDialog } from "./ConfirmDialog";
import { PageHeader } from "./PageShell";
import { CONTENT_ENTRIES_PATH } from "./cms/paths";
import {
  deleteCmsModelResource,
  fetchCmsConfig,
  saveCmsModelResource,
} from "./cms/client";
import {
  CMS_MODEL_FIELD_TYPES,
  cleanCmsModelName,
  cmsCollectionFromModelDraft,
  cmsModelResourceDraftFromCollection,
  newCmsModelFieldDraft,
  newCmsModelResourceDraft,
  titleizeCmsModelName,
  validateCmsModelDraft,
  type CmsModelFieldDraft,
  type CmsModelResourceDraft,
  type CmsModelValidationIssue,
} from "../cms/model/draft";
import type {
  CmsCollectionConfig,
  CmsFieldConfig,
  CmsViewFieldConfig,
} from "../cms/types";

const EMPTY_HEADERS: Record<string, string> = {};
const NEW_RESOURCE_KEY = "__new_resource__";
const NO_TARGET_VALUE = "__no_target__";

interface SaveCmsModelVariables {
  draft: CmsModelResourceDraft;
  originalName: string | null;
}

export function ContentModelManager() {
  return (
    <AuthGuard>
      <ContentModelWorkspace />
    </AuthGuard>
  );
}

function ContentModelWorkspace() {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(
    () => (auth ? buildAuthHeaders(auth) : EMPTY_HEADERS),
    [auth],
  );
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const queryKey = ["cms-config", scope] as const;

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraftState] = useState<CmsModelResourceDraft>(() =>
    newCmsModelResourceDraft(),
  );
  const draftRef = useRef(draft);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftSourceName, setDraftSourceName] = useState<string | null>(null);

  const replaceDraft = useCallback(
    (
      nextDraft: CmsModelResourceDraft,
      options: { dirty?: boolean; sourceName?: string | null } = {},
    ) => {
      draftRef.current = nextDraft;
      setDraftState(nextDraft);
      setDraftDirty(options.dirty ?? true);
      if (Object.prototype.hasOwnProperty.call(options, "sourceName")) {
        setDraftSourceName(options.sourceName ?? null);
      }
    },
    [],
  );

  const cmsQuery = useQuery({
    queryKey,
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });
  const collections = useMemo(
    () => (cmsQuery.data?.configured === true ? cmsQuery.data.collections : []),
    [cmsQuery.data],
  );
  const filteredCollections = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return collections;
    return collections.filter(
      (collection) =>
        collection.name.toLowerCase().includes(term) ||
        collection.label.toLowerCase().includes(term),
    );
  }, [collections, search]);
  const isCreating = selectedName === NEW_RESOURCE_KEY;
  const selectedCollection =
    selectedName && !isCreating
      ? (collections.find((collection) => collection.name === selectedName) ??
        null)
      : null;
  const deleteTarget = deleteTargetName
    ? (collections.find((collection) => collection.name === deleteTargetName) ??
      null)
    : null;

  useEffect(() => {
    if (selectedName || collections.length === 0) return;
    setSelectedName(collections[0].name);
  }, [collections, selectedName]);

  useEffect(() => {
    if (!selectedCollection) return;
    if (draftDirty && draftSourceName === selectedCollection.name) return;
    const nextDraft = cmsModelResourceDraftFromCollection(selectedCollection);
    replaceDraft(nextDraft, {
      dirty: false,
      sourceName: selectedCollection.name,
    });
    setSelectedFieldKey(nextDraft.fields[0]?.key ?? null);
  }, [draftDirty, draftSourceName, replaceDraft, selectedCollection]);

  useEffect(() => {
    if (draft.fields.length === 0) {
      if (selectedFieldKey) setSelectedFieldKey(null);
      return;
    }
    if (
      !selectedFieldKey ||
      !draft.fields.some((field) => field.key === selectedFieldKey)
    ) {
      setSelectedFieldKey(draft.fields[0].key);
    }
  }, [draft.fields, selectedFieldKey]);

  const validationIssues = useMemo(
    () =>
      validateCmsModelDraft({
        draft,
        collections,
        originalName: isCreating ? null : selectedCollection?.name,
      }),
    [collections, draft, isCreating, selectedCollection?.name],
  );

  const saveMutation = useMutation({
    mutationFn: ({ draft: nextDraft, originalName }: SaveCmsModelVariables) =>
      saveCmsModelResource(headers, {
        collection: cmsCollectionFromModelDraft(nextDraft),
        originalName,
      }),
    onSuccess: async (cms, saved) => {
      const savedName = saved.draft.name.trim();
      const savedCollection =
        cms.configured === true
          ? (cms.collections.find(
              (collection) => collection.name === savedName,
            ) ?? null)
          : null;
      const nextDraft = savedCollection
        ? cmsModelResourceDraftFromCollection(savedCollection)
        : saved.draft;

      queryClient.setQueryData(queryKey, cms);
      setSelectedName(savedName);
      replaceDraft(nextDraft, {
        dirty: false,
        sourceName: savedName || null,
      });
      setSelectedFieldKey((currentKey) =>
        currentKey && nextDraft.fields.some((field) => field.key === currentKey)
          ? currentKey
          : (nextDraft.fields[0]?.key ?? null),
      );
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Content model saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save content model",
      );
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (name: string) => deleteCmsModelResource(headers, { name }),
    onSuccess: (cms) => {
      queryClient.setQueryData(queryKey, cms);
      const nextCollections = cms.configured === true ? cms.collections : [];
      const nextName = nextCollections[0]?.name ?? null;
      setSelectedName(nextName);
      if (!nextName) {
        replaceDraft(newCmsModelResourceDraft(), {
          dirty: false,
          sourceName: null,
        });
        setSelectedFieldKey(null);
      }
      toast.success("Content model deleted");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete content model",
      );
    },
  });

  const loading = cmsQuery.isLoading;
  const error =
    cmsQuery.error instanceof Error ? cmsQuery.error.message : undefined;
  const canSave = validationIssues.length === 0;
  const originalName = isCreating ? null : (selectedCollection?.name ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-black/95 text-white/90">
      <PageHeader
        title="Models"
        icon={Database}
        iconClassName="text-emerald-300"
        subtitle={
          cmsQuery.data?.configured === true
            ? `${collections.length} resources`
            : undefined
        }
        backHref={CONTENT_ENTRIES_PATH}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void cmsQuery.refetch()}
              disabled={cmsQuery.isFetching}
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  cmsQuery.isFetching ? "animate-spin" : "",
                )}
              />
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() =>
                saveMutation.mutate({
                  draft: draftRef.current,
                  originalName,
                })
              }
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </>
        }
      />

      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 overflow-hidden grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-border bg-background/70 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
            <div className="text-sm font-medium text-foreground">Resources</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedName(NEW_RESOURCE_KEY);
                const nextDraft = newCmsModelResourceDraft();
                replaceDraft(nextDraft, {
                  dirty: false,
                  sourceName: NEW_RESOURCE_KEY,
                });
                setSelectedFieldKey(null);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New
            </Button>
          </div>
          <div className="border-b border-border p-3">
            <div className="flex h-9 items-center gap-2 rounded border border-border bg-background px-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search"
                className="h-8 border-0 bg-transparent px-0 focus-visible:ring-0"
              />
            </div>
          </div>
          <div
            data-testid="content-model-resource-list"
            className="min-h-0 flex-1 overflow-y-auto p-2"
          >
            {loading ? (
              <LoadingLine />
            ) : filteredCollections.length === 0 && !isCreating ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No resources.
              </div>
            ) : (
              <>
                {isCreating ? (
                  <button
                    type="button"
                    onClick={() => setSelectedName(NEW_RESOURCE_KEY)}
                    className="mb-1 flex w-full min-w-0 flex-col rounded bg-primary/15 px-3 py-2 text-left text-sm text-foreground"
                  >
                    <span className="truncate font-medium">New resource</span>
                    <span className="truncate text-xs">
                      {draft.name || "Not saved yet"}
                    </span>
                  </button>
                ) : null}
                {filteredCollections.map((collection) => (
                  <button
                    key={collection.name}
                    type="button"
                    onClick={() => setSelectedName(collection.name)}
                    className={cn(
                      "mb-1 flex w-full min-w-0 flex-col rounded px-3 py-2 text-left text-sm transition",
                      selectedName === collection.name
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="truncate font-medium">
                      {collection.label}
                    </span>
                    <span className="truncate text-xs">{collection.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden">
          <ResourceBuilder
            draft={draft}
            collections={collections}
            validationIssues={validationIssues}
            selectedFieldKey={selectedFieldKey}
            onSelectedFieldChange={setSelectedFieldKey}
            canDeleteResource={Boolean(selectedCollection)}
            deleteResourceLoading={deleteMutation.isPending}
            onDeleteResource={() => {
              if (selectedCollection)
                setDeleteTargetName(selectedCollection.name);
            }}
            onChange={replaceDraft}
          />
        </main>
      </div>
      <ConfirmDialog
        open={deleteTargetName !== null}
        title="Delete resource?"
        description={`This removes "${
          deleteTarget?.label ?? deleteTargetName ?? "this resource"
        }" from the content schema. It does not delete content documents.`}
        confirmLabel="Delete resource"
        variant="destructive"
        onClose={() => setDeleteTargetName(null)}
        onConfirm={() => {
          if (deleteTargetName) deleteMutation.mutate(deleteTargetName);
        }}
      />
    </div>
  );
}

function ResourceBuilder({
  draft,
  collections,
  validationIssues,
  selectedFieldKey,
  onSelectedFieldChange,
  canDeleteResource,
  deleteResourceLoading,
  onDeleteResource,
  onChange,
}: {
  draft: CmsModelResourceDraft;
  collections: CmsCollectionConfig[];
  validationIssues: CmsModelValidationIssue[];
  selectedFieldKey: string | null;
  onSelectedFieldChange: (key: string | null) => void;
  canDeleteResource: boolean;
  deleteResourceLoading: boolean;
  onDeleteResource: () => void;
  onChange: (draft: CmsModelResourceDraft) => void;
}) {
  const resourceOptions = useMemo(() => {
    const options = collections.map((collection) => ({
      name: collection.name,
      label: collection.label,
    }));
    const draftName = draft.name.trim();
    if (draftName && !options.some((option) => option.name === draftName)) {
      options.push({
        name: draftName,
        label: draft.label.trim() || titleizeCmsModelName(draftName),
      });
    }
    return options;
  }, [collections, draft.label, draft.name]);

  const updateField = (key: string, patch: Partial<CmsModelFieldDraft>) => {
    onChange({
      ...draft,
      fields: draft.fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    });
  };

  const addField = () => {
    const field = newCmsModelFieldDraft(draft.fields.length);
    onChange({
      ...draft,
      fields: [...draft.fields, field],
    });
    onSelectedFieldChange(field.key);
  };

  const removeField = (key: string) => {
    const fields = draft.fields.filter((field) => field.key !== key);
    onChange({
      ...draft,
      fields,
    });
    if (selectedFieldKey === key) {
      onSelectedFieldChange(fields[0]?.key ?? null);
    }
  };

  const issuesByField = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const issue of validationIssues) {
      if (!issue.fieldKey) continue;
      result.set(issue.fieldKey, [
        ...(result.get(issue.fieldKey) ?? []),
        issue.message,
      ]);
    }
    return result;
  }, [validationIssues]);
  const resourceIssues = validationIssues.filter((issue) => !issue.fieldKey);
  const selectedField =
    draft.fields.find((field) => field.key === selectedFieldKey) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ResourceSettingsBar
        draft={draft}
        canDeleteResource={canDeleteResource}
        deleteResourceLoading={deleteResourceLoading}
        onDeleteResource={onDeleteResource}
        onChange={onChange}
      />

      {resourceIssues.length > 0 ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {resourceIssues.map((issue) => (
            <div key={issue.message}>{issue.message}</div>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <FieldsTable
          fields={draft.fields}
          selectedFieldKey={selectedFieldKey}
          issuesByField={issuesByField}
          onAddField={addField}
          onRemoveField={removeField}
          onSelectField={onSelectedFieldChange}
        />
        <aside className="flex min-h-0 flex-col overflow-y-auto border-t border-border bg-background/40 xl:border-l xl:border-t-0">
          <FieldInspector
            field={selectedField}
            resources={resourceOptions}
            issues={
              selectedField ? (issuesByField.get(selectedField.key) ?? []) : []
            }
            onUpdateField={updateField}
            onRemoveField={removeField}
          />
          <div className="border-t border-border">
            <ResourcePreview draft={draft} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function ResourceSettingsBar({
  draft,
  canDeleteResource,
  deleteResourceLoading,
  onDeleteResource,
  onChange,
}: {
  draft: CmsModelResourceDraft;
  canDeleteResource: boolean;
  deleteResourceLoading: boolean;
  onDeleteResource: () => void;
  onChange: (draft: CmsModelResourceDraft) => void;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-background/80 px-4 py-3">
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 truncate text-base font-semibold">
            {draft.label.trim() || draft.name.trim() || "New resource"}
          </div>
          <Badge variant="outline">{draft.fields.length} fields</Badge>
        </div>
        {canDeleteResource ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDeleteResource}
            disabled={deleteResourceLoading}
            aria-label="Delete resource"
          >
            {deleteResourceLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <FieldShell label="Name">
          <Input
            value={draft.name}
            onChange={(event) => {
              const name = cleanCmsModelName(event.target.value);
              onChange({
                ...draft,
                name,
                sourceCollection:
                  draft.sourceCollection.trim().length > 0
                    ? draft.sourceCollection
                    : name,
              });
            }}
            placeholder="products"
            className="h-9"
          />
        </FieldShell>
        <FieldShell label="Label">
          <Input
            value={draft.label}
            onChange={(event) =>
              onChange({ ...draft, label: event.target.value })
            }
            placeholder="Products"
            className="h-9"
          />
        </FieldShell>
        <FieldShell label="Source">
          <Input
            value={draft.sourceCollection}
            onChange={(event) =>
              onChange({
                ...draft,
                sourceCollection: cleanCmsModelName(event.target.value),
              })
            }
            placeholder={draft.name || "products"}
            className="h-9"
          />
        </FieldShell>
      </div>
    </div>
  );
}

function FieldsTable({
  fields,
  selectedFieldKey,
  issuesByField,
  onAddField,
  onRemoveField,
  onSelectField,
}: {
  fields: CmsModelFieldDraft[];
  selectedFieldKey: string | null;
  issuesByField: Map<string, string[]>;
  onAddField: () => void;
  onRemoveField: (key: string) => void;
  onSelectField: (key: string) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">Fields</div>
          <div className="text-xs text-muted-foreground">
            {fields.length} configured
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAddField}>
          <Plus className="mr-2 h-4 w-4" />
          Add field
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {fields.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center px-4 text-sm text-muted-foreground">
            No fields yet.
          </div>
        ) : (
          <div className="min-w-[780px]">
            <div className="grid grid-cols-[minmax(190px,1.3fr)_minmax(130px,1fr)_120px_170px_minmax(150px,1fr)_44px] border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
              <div>Field</div>
              <div>Slug</div>
              <div>Type</div>
              <div>Flags</div>
              <div>Details</div>
              <div />
            </div>
            {fields.map((field) => {
              const selected = selectedFieldKey === field.key;
              const issues = issuesByField.get(field.key) ?? [];
              return (
                <div
                  key={field.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectField(field.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectField(field.key);
                    }
                  }}
                  className={cn(
                    "grid cursor-pointer grid-cols-[minmax(190px,1.3fr)_minmax(130px,1fr)_120px_170px_minmax(150px,1fr)_44px] items-center border-b border-border px-4 py-3 text-sm outline-none transition",
                    selected
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {field.label || field.name || "Untitled field"}
                    </div>
                    {issues.length > 0 ? (
                      <div className="mt-1 text-xs text-destructive">
                        {issues.length} issue{issues.length === 1 ? "" : "s"}
                      </div>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-xs">
                    {field.name || "-"}
                  </div>
                  <div>{fieldTypeLabel(field.type)}</div>
                  <FieldFlagBadges field={field} />
                  <div className="truncate text-xs">{fieldDetail(field)}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemoveField(field.key);
                    }}
                    aria-label={`Remove ${field.label || field.name || "field"}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FieldInspector({
  field,
  resources,
  issues,
  onUpdateField,
  onRemoveField,
}: {
  field: CmsModelFieldDraft | null;
  resources: { name: string; label: string }[];
  issues: string[];
  onUpdateField: (key: string, patch: Partial<CmsModelFieldDraft>) => void;
  onRemoveField: (key: string) => void;
}) {
  if (!field) {
    return (
      <section className="shrink-0 px-4 py-8 text-center text-sm text-muted-foreground">
        Select a field to edit its settings.
      </section>
    );
  }

  return (
    <section className="shrink-0 space-y-4 p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {field.label || field.name || "Untitled field"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fieldTypeLabel(field.type)}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemoveField(field.key)}
          aria-label={`Remove ${field.label || field.name || "field"}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {issues.length > 0 ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {issues.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-3">
        <FieldShell label="Name">
          <Input
            value={field.name}
            onChange={(event) =>
              onUpdateField(field.key, {
                name: cleanCmsModelName(event.target.value),
              })
            }
            className="h-9"
          />
        </FieldShell>
        <FieldShell label="Label">
          <Input
            value={field.label}
            onChange={(event) =>
              onUpdateField(field.key, { label: event.target.value })
            }
            className="h-9"
          />
        </FieldShell>
        <FieldShell label="Type">
          <Select
            value={field.type}
            onValueChange={(value) =>
              onUpdateField(field.key, {
                type: value as CmsModelFieldDraft["type"],
              })
            }
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CMS_MODEL_FIELD_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>
      </div>

      <div className="grid gap-2 border-y border-border py-3">
        <CheckControl
          label="Required"
          checked={field.required}
          onChange={(checked) =>
            onUpdateField(field.key, { required: checked })
          }
        />
        <CheckControl
          label="Read only"
          checked={field.readOnly}
          onChange={(checked) =>
            onUpdateField(field.key, { readOnly: checked })
          }
        />
        <CheckControl
          label="Hidden"
          checked={field.hidden}
          onChange={(checked) => onUpdateField(field.key, { hidden: checked })}
        />
      </div>

      {(field.type === "select" || field.type === "multiSelect") && (
        <FieldShell label="Options">
          <Textarea
            value={field.optionsText}
            onChange={(event) =>
              onUpdateField(field.key, { optionsText: event.target.value })
            }
            placeholder="draft, live"
            className="min-h-24"
          />
        </FieldShell>
      )}

      {(field.type === "relation" || field.type === "relationMany") && (
        <div className="grid gap-3">
          <FieldShell label="Target resource">
            <Select
              value={field.target || NO_TARGET_VALUE}
              onValueChange={(value) =>
                onUpdateField(field.key, {
                  target: value === NO_TARGET_VALUE ? "" : value,
                })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select resource" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TARGET_VALUE}>Select resource</SelectItem>
                {resources.map((resource) => (
                  <SelectItem key={resource.name} value={resource.name}>
                    {resource.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Value field">
            <Input
              value={field.valueField}
              onChange={(event) =>
                onUpdateField(field.key, {
                  valueField: cleanCmsModelName(event.target.value),
                })
              }
              placeholder="_id"
              className="h-9"
            />
          </FieldShell>
          <FieldShell label="Label field">
            <Input
              value={field.labelField}
              onChange={(event) =>
                onUpdateField(field.key, {
                  labelField: cleanCmsModelName(event.target.value),
                })
              }
              placeholder="title"
              className="h-9"
            />
          </FieldShell>
        </div>
      )}
    </section>
  );
}

function FieldFlagBadges({ field }: { field: CmsModelFieldDraft }) {
  const flags = [
    field.required ? "Required" : null,
    field.readOnly ? "Read only" : null,
    field.hidden ? "Hidden" : null,
  ].filter(Boolean);

  if (flags.length === 0) {
    return <span className="text-xs text-muted-foreground">Default</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {flags.map((flag) => (
        <Badge key={flag} variant="outline" className="text-[11px]">
          {flag}
        </Badge>
      ))}
    </div>
  );
}

function fieldTypeLabel(type: CmsModelFieldDraft["type"]): string {
  return (
    CMS_MODEL_FIELD_TYPES.find((option) => option.value === type)?.label ?? type
  );
}

function fieldDetail(field: CmsModelFieldDraft): string {
  if (field.type === "select" || field.type === "multiSelect") {
    const options = field.optionsText
      .split(/[\n,]+/)
      .map((option) => option.trim())
      .filter(Boolean);
    if (options.length === 0) return "No options";
    return `${options.length} option${options.length === 1 ? "" : "s"}`;
  }

  if (field.type === "relation" || field.type === "relationMany") {
    return field.target ? `Links to ${field.target}` : "No target";
  }

  return field.placeholder || field.description || "-";
}

function ResourcePreview({ draft }: { draft: CmsModelResourceDraft }) {
  const collection = cmsCollectionFromModelDraft(draft);
  const tableFields = collection.views?.table?.fields ?? [];
  const formFields = collection.views?.form?.fields ?? [];
  const fieldsByName = new Map(
    collection.fields.map((field) => [field.name, field]),
  );

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-2">
      <section className="rounded border border-border bg-background/60">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">
          Table
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[520px] grid-cols-4 border-b border-border px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            {tableFields.slice(0, 4).map((field) => (
              <div key={field.name}>{fieldLabel(fieldsByName, field)}</div>
            ))}
          </div>
          <div className="grid min-w-[520px] grid-cols-4 px-3 py-3 text-sm text-muted-foreground">
            {tableFields.slice(0, 4).map((field) => (
              <div key={field.name}>Sample</div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded border border-border bg-background/60">
        <div className="border-b border-border px-3 py-2 text-sm font-medium">
          Form
        </div>
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {formFields.slice(0, 8).map((field) => {
            const config = fieldsByName.get(field.name);
            return (
              <FieldShell
                key={field.name}
                label={fieldLabel(fieldsByName, field)}
              >
                <Input
                  value=""
                  readOnly
                  placeholder={config?.placeholder ?? config?.type ?? ""}
                  className="h-9"
                />
              </FieldShell>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function FieldShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs uppercase text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CheckControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function LoadingLine() {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading
    </div>
  );
}

function fieldLabel(
  fieldsByName: Map<string, CmsFieldConfig>,
  viewField: CmsViewFieldConfig,
): string {
  return (
    viewField.label ?? fieldsByName.get(viewField.name)?.label ?? viewField.name
  );
}
