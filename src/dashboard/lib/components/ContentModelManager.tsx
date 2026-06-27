"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@dashboard/ui/tabs";
import { Textarea } from "@dashboard/ui/textarea";

import { PageHeader } from "./PageShell";
import { fetchCmsConfig, saveCmsModelResource } from "./cms/client";
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
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<CmsModelResourceDraft>(() =>
    newCmsModelResourceDraft(),
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

  useEffect(() => {
    if (selectedName || collections.length === 0) return;
    setSelectedName(collections[0].name);
  }, [collections, selectedName]);

  useEffect(() => {
    if (!selectedCollection) return;
    setDraft(cmsModelResourceDraftFromCollection(selectedCollection));
  }, [selectedCollection]);

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
    mutationFn: (nextDraft: CmsModelResourceDraft) =>
      saveCmsModelResource(headers, {
        collection: cmsCollectionFromModelDraft(nextDraft),
        originalName: isCreating ? null : selectedCollection?.name,
      }),
    onSuccess: async (cms) => {
      queryClient.setQueryData(queryKey, cms);
      await queryClient.invalidateQueries({ queryKey });
      setSelectedName(draft.name.trim());
      toast.success("Content model saved");
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save content model",
      );
    },
  });

  const loading = cmsQuery.isLoading;
  const error =
    cmsQuery.error instanceof Error ? cmsQuery.error.message : undefined;
  const canSave = validationIssues.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-black/95 text-white/90">
      <PageHeader
        title="Content Model"
        icon={Database}
        iconClassName="text-emerald-300"
        subtitle={
          cmsQuery.data?.configured === true
            ? `${collections.length} resources`
            : undefined
        }
        backHref="/cms"
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
              onClick={() => saveMutation.mutate(draft)}
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
                setDraft(newCmsModelResourceDraft());
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

        <main className="min-h-0 overflow-y-auto">
          <Tabs defaultValue="fields" className="flex min-h-full flex-col">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">
                  {draft.label.trim() || draft.name.trim() || "New resource"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {draft.name ? <span>{draft.name}</span> : null}
                  <Badge variant="outline">{draft.fields.length} fields</Badge>
                </div>
              </div>
              <TabsList className="h-9">
                <TabsTrigger value="fields">Fields</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="fields" className="m-0 flex-1">
              <ResourceFieldsEditor
                draft={draft}
                collections={collections}
                validationIssues={validationIssues}
                onChange={setDraft}
              />
            </TabsContent>
            <TabsContent value="preview" className="m-0 flex-1">
              <ResourcePreview draft={draft} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}

function ResourceFieldsEditor({
  draft,
  collections,
  validationIssues,
  onChange,
}: {
  draft: CmsModelResourceDraft;
  collections: CmsCollectionConfig[];
  validationIssues: CmsModelValidationIssue[];
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

  const removeField = (key: string) => {
    onChange({
      ...draft,
      fields: draft.fields.filter((field) => field.key !== key),
    });
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

  return (
    <div className="space-y-4 p-4">
      {resourceIssues.length > 0 ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {resourceIssues.map((issue) => (
            <div key={issue.message}>{issue.message}</div>
          ))}
        </div>
      ) : null}

      <section className="grid gap-3 border-b border-border pb-4 md:grid-cols-3">
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
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">Fields</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                ...draft,
                fields: [
                  ...draft.fields,
                  newCmsModelFieldDraft(draft.fields.length),
                ],
              })
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Add field
          </Button>
        </div>

        <div className="space-y-2">
          {draft.fields.map((field) => (
            <div
              key={field.key}
              className="grid gap-3 rounded border border-border bg-background/60 p-3 xl:grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_150px_220px_40px]"
            >
              <FieldShell label="Name">
                <Input
                  value={field.name}
                  onChange={(event) =>
                    updateField(field.key, {
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
                    updateField(field.key, { label: event.target.value })
                  }
                  className="h-9"
                />
              </FieldShell>
              <FieldShell label="Type">
                <Select
                  value={field.type}
                  onValueChange={(value) =>
                    updateField(field.key, {
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
              <div className="grid grid-cols-3 gap-2 pt-6">
                <CheckControl
                  label="Required"
                  checked={field.required}
                  onChange={(checked) =>
                    updateField(field.key, { required: checked })
                  }
                />
                <CheckControl
                  label="Read only"
                  checked={field.readOnly}
                  onChange={(checked) =>
                    updateField(field.key, { readOnly: checked })
                  }
                />
                <CheckControl
                  label="Hidden"
                  checked={field.hidden}
                  onChange={(checked) =>
                    updateField(field.key, { hidden: checked })
                  }
                />
              </div>
              <div className="flex items-end justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeField(field.key)}
                  aria-label={`Remove ${field.label || field.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {(field.type === "select" || field.type === "multiSelect") && (
                <FieldShell label="Options" className="xl:col-span-5">
                  <Textarea
                    value={field.optionsText}
                    onChange={(event) =>
                      updateField(field.key, {
                        optionsText: event.target.value,
                      })
                    }
                    placeholder="draft, live"
                    className="min-h-20"
                  />
                </FieldShell>
              )}
              {(field.type === "relation" || field.type === "relationMany") && (
                <div className="grid gap-3 xl:col-span-5 xl:grid-cols-3">
                  <FieldShell label="Target resource">
                    <Select
                      value={field.target || NO_TARGET_VALUE}
                      onValueChange={(value) =>
                        updateField(field.key, {
                          target: value === NO_TARGET_VALUE ? "" : value,
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select resource" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_TARGET_VALUE}>
                          Select resource
                        </SelectItem>
                        {resourceOptions.map((resource) => (
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
                        updateField(field.key, {
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
                        updateField(field.key, {
                          labelField: cleanCmsModelName(event.target.value),
                        })
                      }
                      placeholder="title"
                      className="h-9"
                    />
                  </FieldShell>
                </div>
              )}
              {(issuesByField.get(field.key) ?? []).map((message) => (
                <div
                  key={message}
                  className="text-sm text-destructive xl:col-span-5"
                >
                  {message}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
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
