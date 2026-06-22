"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { cn } from "@dashboard/lib/utils";
import { Badge } from "@dashboard/ui/badge";
import { Button } from "@dashboard/ui/button";
import { Checkbox } from "@dashboard/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
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
import type {
  CmsCollectionConfig,
  CmsConfigState,
  CmsDocument,
  CmsFieldConfig,
  CmsFieldOption,
  CmsFilterConfig,
  CmsFilterOperator,
  CmsListResult,
  CmsSearchQuery,
  CmsSortEntry,
  CmsViewFieldConfig,
} from "../cms/types";

const PAGE_SIZE = 25;

interface CmsIndexResponse {
  cms?: CmsConfigState;
  error?: string;
  message?: string;
}

interface CmsDocumentResponse {
  document?: CmsDocument;
  error?: string;
  message?: string;
}

interface CmsDeleteResponse {
  deleted?: boolean;
  error?: string;
  message?: string;
}

interface CmsSetupPayload {
  name: string;
  databaseUriSecret: string;
  databaseName: string;
  collectionName: string;
  collectionLabel: string;
  idField: string;
  titleField: string;
}

type FilterValue = {
  operator: CmsFilterOperator;
  value: string | string[];
};

type FilterValues = Record<string, FilterValue>;

interface CmsRelationContextValue {
  headers: Record<string, string>;
  collections: CmsCollectionConfig[];
  scope: string;
}

const CmsRelationContext = createContext<CmsRelationContextValue | null>(null);

export function CmsManager() {
  return (
    <AuthGuard>
      <CmsListPage />
    </AuthGuard>
  );
}

export function CmsItemManager({
  collectionName,
  documentId,
}: {
  collectionName: string;
  documentId: string;
}) {
  return (
    <AuthGuard>
      <CmsItemPage collectionName={collectionName} documentId={documentId} />
    </AuthGuard>
  );
}

export function CmsCreateManager({
  collectionName,
}: {
  collectionName: string;
}) {
  return (
    <AuthGuard>
      <CmsCreatePage collectionName={collectionName} />
    </AuthGuard>
  );
}

function CmsListPage() {
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const cmsQueryKey = ["cms-config", scope] as const;

  const [selectedCollectionName, setSelectedCollectionName] =
    useState<string>("");
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [sort, setSort] = useState<CmsSortEntry[]>([]);
  const [offset, setOffset] = useState(0);

  const cmsQuery = useQuery({
    queryKey: cmsQueryKey,
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });

  const setupMutation = useMutation({
    mutationFn: (payload: CmsSetupPayload) => setupCms(headers, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: cmsQueryKey });
    },
  });

  const cmsConfigured = cmsQuery.data?.configured !== false;
  const collections = useMemo(
    () => (cmsConfigured ? (cmsQuery.data?.collections ?? []) : []),
    [cmsConfigured, cmsQuery.data?.collections],
  );

  const selectedCollection =
    collections.find(
      (collection) => collection.name === selectedCollectionName,
    ) ??
    collections[0] ??
    null;

  useEffect(() => {
    if (!selectedCollectionName && collections[0]) {
      setSelectedCollectionName(collections[0].name);
    }
  }, [collections, selectedCollectionName]);

  useEffect(() => {
    setFilterValues({});
    setSort([]);
    setOffset(0);
  }, [selectedCollectionName]);

  const activeFilters = useMemo(
    () => buildFilters(selectedCollection, filterValues),
    [filterValues, selectedCollection],
  );
  const activeSort =
    sort.length > 0 ? sort : (selectedCollection?.defaultSort ?? []);
  const pageSize = selectedCollection?.views?.list?.pageSize ?? PAGE_SIZE;

  const documentsQuery = useQuery({
    queryKey: [
      "cms-documents",
      scope,
      selectedCollection?.name ?? null,
      JSON.stringify(activeFilters),
      JSON.stringify(activeSort),
      offset,
      pageSize,
    ],
    queryFn: () =>
      fetchCmsDocuments(
        headers,
        selectedCollection?.name ?? "",
        activeFilters,
        undefined,
        activeSort,
        pageSize,
        offset,
      ),
    enabled: Boolean(auth && selectedCollection),
  });

  const documents = useMemo(
    () => documentsQuery.data?.docs ?? [],
    [documentsQuery.data?.docs],
  );

  const error =
    cmsQuery.error instanceof Error
      ? cmsQuery.error.message
      : documentsQuery.error instanceof Error
        ? documentsQuery.error.message
        : null;

  if (cmsQuery.data?.configured === false) {
    return (
      <CmsShell
        title="CMS"
        subtitle="Not configured"
        actions={null}
        error={null}
      >
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 md:px-8">
          <CmsSetupPanel
            repoName={auth?.repo ?? "Repo"}
            loading={setupMutation.isPending}
            error={
              setupMutation.error instanceof Error
                ? setupMutation.error.message
                : null
            }
            onSubmit={(payload) => setupMutation.mutate(payload)}
          />
        </div>
      </CmsShell>
    );
  }

  return (
    <CmsShell
      title="CMS"
      subtitle={
        cmsQuery.data
          ? `${cmsQuery.data.name} / ${cmsQuery.data.environment}`
          : undefined
      }
      error={error}
      actions={
        <CmsHeaderActions
          loading={cmsQuery.isFetching || documentsQuery.isFetching}
          writePolicy={
            cmsQuery.data?.configured ? cmsQuery.data.writePolicy : undefined
          }
          onRefresh={() => {
            void cmsQuery.refetch();
            void documentsQuery.refetch();
          }}
        />
      }
    >
      <CmsRelationProvider
        headers={headers}
        collections={collections}
        scope={scope}
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
          <CollectionRail
            loading={cmsQuery.isLoading}
            collections={collections}
            selectedName={selectedCollection?.name ?? ""}
            onSelect={setSelectedCollectionName}
          />

          <main className="flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0">
            <CollectionWorkspace
              collection={selectedCollection}
              documents={documents}
              total={documentsQuery.data?.total ?? 0}
              offset={offset}
              limit={documentsQuery.data?.limit ?? pageSize}
              loading={documentsQuery.isLoading}
              fetching={documentsQuery.isFetching}
              filterValues={filterValues}
              sort={activeSort}
              onFilterChange={(next) => {
                setFilterValues(next);
                setOffset(0);
              }}
              onSortChange={(next) => {
                setSort(next);
                setOffset(0);
              }}
              onOpenDocument={(id) => {
                if (!selectedCollection) return;
                router.push(
                  `/cms/${encodeURIComponent(selectedCollection.name)}/${encodeURIComponent(id)}`,
                );
              }}
              onCreateDocument={() => {
                if (!selectedCollection) return;
                router.push(
                  `/cms/new/${encodeURIComponent(selectedCollection.name)}`,
                );
              }}
              onPageChange={setOffset}
            />
          </main>
        </div>
      </CmsRelationProvider>
    </CmsShell>
  );
}

function CmsItemPage({
  collectionName,
  documentId,
}: {
  collectionName: string;
  documentId: string;
}) {
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const cmsQuery = useQuery({
    queryKey: ["cms-config", scope],
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });

  const collections =
    cmsQuery.data?.configured === true ? cmsQuery.data.collections : [];
  const collection =
    collections.find((candidate) => candidate.name === collectionName) ?? null;

  const documentQuery = useQuery({
    queryKey: ["cms-document", scope, collectionName, documentId],
    queryFn: () => fetchCmsDocument(headers, collectionName, documentId),
    enabled: Boolean(auth && collection),
  });

  const error =
    cmsQuery.error instanceof Error
      ? cmsQuery.error.message
      : documentQuery.error instanceof Error
        ? documentQuery.error.message
        : null;

  const document = documentQuery.data ?? null;
  const title =
    collection && document ? getDocumentTitle(collection, document) : "Item";
  const documentQueryKey = ["cms-document", scope, collectionName, documentId];
  const updateMutation = useMutation({
    mutationFn: (payload: CmsDocument) =>
      updateCmsDocument(headers, collectionName, documentId, payload),
    onSuccess: async (updated) => {
      queryClient.setQueryData(documentQueryKey, updated);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["cms-documents"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteCmsDocument(headers, collectionName, documentId),
    onSuccess: async () => {
      setDeleteOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["cms-documents"] });
      router.push("/cms");
    },
  });
  const mutationError =
    updateMutation.error instanceof Error
      ? updateMutation.error.message
      : deleteMutation.error instanceof Error
        ? deleteMutation.error.message
        : null;

  return (
    <CmsShell
      title={title}
      subtitle={collection ? `${collection.label} / ${collection.name}` : "CMS"}
      error={error ?? mutationError}
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push("/cms")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            List
          </Button>
          {collection && document ? (
            <CrudActions
              collection={collection}
              compact={false}
              editing={editing}
              loading={updateMutation.isPending || deleteMutation.isPending}
              onEdit={() => setEditing(true)}
              onCancelEdit={() => setEditing(false)}
              onDelete={() => setDeleteOpen(true)}
            />
          ) : null}
        </div>
      }
    >
      {!collection && cmsQuery.isLoading ? (
        <LoadingRows />
      ) : !collection ? (
        <EmptyState
          title="Collection unavailable"
          detail="The collection config was not found."
        />
      ) : documentQuery.isLoading ? (
        <LoadingRows />
      ) : !document ? (
        <EmptyState
          title="Item unavailable"
          detail="The selected item was not found."
        />
      ) : (
        <CmsRelationProvider
          headers={headers}
          collections={collections}
          scope={scope}
        >
          <ContentDetailPage
            collection={collection}
            document={document}
            editing={editing}
            saving={updateMutation.isPending}
            onSubmit={(payload) => updateMutation.mutate(payload)}
          />
        </CmsRelationProvider>
      )}
      {collection && document ? (
        <DeleteConfirmDialog
          open={deleteOpen}
          collection={collection}
          document={document}
          loading={deleteMutation.isPending}
          onOpenChange={setDeleteOpen}
          onConfirm={() => deleteMutation.mutate()}
        />
      ) : null}
    </CmsShell>
  );
}

function CmsCreatePage({ collectionName }: { collectionName: string }) {
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;

  const cmsQuery = useQuery({
    queryKey: ["cms-config", scope],
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });

  const collections =
    cmsQuery.data?.configured === true ? cmsQuery.data.collections : [];
  const collection =
    collections.find((candidate) => candidate.name === collectionName) ?? null;

  const createMutation = useMutation({
    mutationFn: (payload: CmsDocument) =>
      createCmsDocument(headers, collectionName, payload),
    onSuccess: async (document) => {
      await queryClient.invalidateQueries({ queryKey: ["cms-documents"] });
      if (!collection) {
        router.push("/cms");
        return;
      }
      const id = getDocumentId(document, collection.source.idField ?? "_id");
      router.push(
        `/cms/${encodeURIComponent(collection.name)}/${encodeURIComponent(id)}`,
      );
    },
  });

  const error =
    cmsQuery.error instanceof Error
      ? cmsQuery.error.message
      : createMutation.error instanceof Error
        ? createMutation.error.message
        : null;

  return (
    <CmsShell
      title={collection ? `New ${collection.label}` : "New item"}
      subtitle={collection ? `${collection.label} / ${collection.name}` : "CMS"}
      error={error}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push("/cms")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          List
        </Button>
      }
    >
      {!collection && cmsQuery.isLoading ? (
        <LoadingRows />
      ) : !collection ? (
        <EmptyState
          title="Collection unavailable"
          detail="The collection config was not found."
        />
      ) : !canWriteOperation(collection, "create") ? (
        <EmptyState
          title="Create unavailable"
          detail={writeDisabledReason(collection)}
        />
      ) : (
        <CmsRelationProvider
          headers={headers}
          collections={collections}
          scope={scope}
        >
          <ContentFormPage
            collection={collection}
            saving={createMutation.isPending}
            onSubmit={(payload) => createMutation.mutate(payload)}
          />
        </CmsRelationProvider>
      )}
    </CmsShell>
  );
}

function CmsShell({
  title,
  subtitle,
  actions,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions: React.ReactNode;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <PageHeader
        title={title}
        icon={Database}
        iconClassName="text-primary"
        subtitle={subtitle}
        actions={actions}
      />

      {error ? (
        <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {children}
    </div>
  );
}

function CmsRelationProvider({
  headers,
  collections,
  scope,
  children,
}: {
  headers: Record<string, string>;
  collections: CmsCollectionConfig[];
  scope: string;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({ headers, collections, scope }),
    [headers, collections, scope],
  );

  return (
    <CmsRelationContext.Provider value={value}>
      {children}
    </CmsRelationContext.Provider>
  );
}

function CmsHeaderActions({
  loading,
  writePolicy,
  onRefresh,
}: {
  loading: boolean;
  writePolicy?: string;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="secondary"
        className="rounded border border-border bg-muted text-foreground"
      >
        {writePolicy ?? "Loading"}
      </Badge>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        Refresh
      </Button>
    </div>
  );
}

function CollectionRail({
  loading,
  collections,
  selectedName,
  onSelect,
}: {
  loading: boolean;
  collections: CmsCollectionConfig[];
  selectedName: string;
  onSelect: (name: string) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-border">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Collections
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {collections.length} configured
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <LoadingRows />
        ) : collections.length === 0 ? (
          <EmptyState
            title="No collections"
            detail="No collection config found."
          />
        ) : (
          <div className="space-y-1">
            {collections.map((collection) => {
              const selected = collection.name === selectedName;

              return (
                <button
                  key={collection.name}
                  type="button"
                  onClick={() => onSelect(collection.name)}
                  className={cn(
                    "w-full rounded border px-3 py-2 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/10"
                      : "border-transparent hover:border-border hover:bg-muted",
                  )}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {collection.label}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{collection.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

function CollectionWorkspace({
  collection,
  documents,
  total,
  offset,
  limit,
  loading,
  fetching,
  filterValues,
  sort,
  onFilterChange,
  onSortChange,
  onOpenDocument,
  onCreateDocument,
  onPageChange,
}: {
  collection: CmsCollectionConfig | null;
  documents: CmsDocument[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  fetching: boolean;
  filterValues: FilterValues;
  sort: CmsSortEntry[];
  onFilterChange: (next: FilterValues) => void;
  onSortChange: (next: CmsSortEntry[]) => void;
  onOpenDocument: (id: string) => void;
  onCreateDocument: () => void;
  onPageChange: (offset: number) => void;
}) {
  if (!collection) {
    return (
      <EmptyState
        title="Select a collection"
        detail="No collection selected."
      />
    );
  }

  const filtersActive = Object.values(filterValues).some(
    (filter) => !isBlankFilterValue(filter.value),
  );

  return (
    <>
      <div className="shrink-0 border-b border-border">
        <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-foreground">
                {collection.label}
              </h2>
              {fetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{collection.name}</span>
              <span>{total.toLocaleString()} items</span>
            </div>
          </div>

          {collection.operations.create ? (
            <Button
              type="button"
              disabled={!canWriteOperation(collection, "create")}
              size="sm"
              title={
                canWriteOperation(collection, "create")
                  ? "New"
                  : writeDisabledReason(collection)
              }
              onClick={onCreateDocument}
            >
              <Plus className="mr-2 h-4 w-4" />
              New
            </Button>
          ) : null}
        </div>

        <CollectionFilters
          collection={collection}
          values={filterValues}
          filtersActive={filtersActive}
          onChange={onFilterChange}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <LoadingRows />
        ) : (
          <DocumentTable
            collection={collection}
            documents={documents}
            sort={sort}
            onSortChange={onSortChange}
            onOpen={onOpenDocument}
          />
        )}
      </div>

      <DocumentPager
        total={total}
        offset={offset}
        limit={limit}
        shown={documents.length}
        loading={fetching}
        onChange={onPageChange}
      />
    </>
  );
}

function CrudActions({
  collection,
  compact,
  editing,
  loading,
  onEdit,
  onCancelEdit,
  onDelete,
}: {
  collection: CmsCollectionConfig;
  compact: boolean;
  editing?: boolean;
  loading?: boolean;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!collection.operations.update && !collection.operations.delete) {
    return null;
  }

  const disabledReason = writeDisabledReason(collection);

  return (
    <div className="flex items-center gap-2">
      {collection.operations.update ? (
        <Button
          type="button"
          size={compact ? "icon" : "sm"}
          disabled={
            loading || (!editing && !canWriteOperation(collection, "update"))
          }
          title={
            canWriteOperation(collection, "update") ? "Edit" : disabledReason
          }
          variant="default"
          onClick={editing ? onCancelEdit : onEdit}
        >
          <Pencil className={cn("h-4 w-4", compact ? "" : "mr-2")} />
          {compact ? (
            <span className="sr-only">{editing ? "Cancel" : "Edit"}</span>
          ) : editing ? (
            "Cancel"
          ) : (
            "Edit"
          )}
        </Button>
      ) : null}
      {collection.operations.delete ? (
        <Button
          type="button"
          size={compact ? "icon" : "sm"}
          disabled={loading || !canWriteOperation(collection, "delete")}
          title={
            canWriteOperation(collection, "delete") ? "Delete" : disabledReason
          }
          variant="outline"
          onClick={onDelete}
        >
          {loading ? (
            <Loader2
              className={cn("h-4 w-4 animate-spin", compact ? "" : "mr-2")}
            />
          ) : (
            <Trash2 className={cn("h-4 w-4", compact ? "" : "mr-2")} />
          )}
          {compact ? <span className="sr-only">Delete</span> : "Delete"}
        </Button>
      ) : null}
    </div>
  );
}

function DeleteConfirmDialog({
  open,
  collection,
  document,
  loading,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  collection: CmsCollectionConfig;
  document: CmsDocument;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const id = getDocumentId(document, collection.source.idField ?? "_id");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-foreground">
        <DialogHeader>
          <DialogTitle>Delete {collection.label}</DialogTitle>
          <DialogDescription>
            {getDocumentTitle(collection, document)}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This permanently deletes record{" "}
          <span className="font-mono">{id}</span>.
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function canWriteOperation(
  collection: CmsCollectionConfig,
  operation: "create" | "update" | "delete",
): boolean {
  return (
    collection.operations[operation] && collection.writePolicy === "enabled"
  );
}

function writeDisabledReason(collection: CmsCollectionConfig): string {
  if (collection.writePolicy === "approval-required")
    return "Approval required";
  if (collection.writePolicy === "read-only") return "Read-only";
  return "Operation disabled";
}

function CollectionFilters({
  collection,
  values,
  filtersActive,
  onChange,
}: {
  collection: CmsCollectionConfig;
  values: FilterValues;
  filtersActive: boolean;
  onChange: (next: FilterValues) => void;
}) {
  const filters = collection.filters;

  if (filters.length === 0) {
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <SlidersHorizontal className="h-4 w-4" />
        No filters configured
      </div>
    );
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-end">
        <div className="grid flex-1 grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
          {filters.map((filter) => {
            const field = collection.fields.find(
              (candidate) => candidate.name === filter.field,
            );
            if (!field) return null;

            return (
              <FilterControl
                key={filter.field}
                field={field}
                filter={filter}
                value={values[filter.field] ?? defaultFilterValue(filter)}
                onChange={(value) =>
                  onChange({
                    ...values,
                    [filter.field]: value,
                  })
                }
              />
            );
          })}
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!filtersActive}
          onClick={() => onChange({})}
          className="w-full xl:w-auto"
        >
          <X className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}

function FilterControl({
  field,
  filter,
  value,
  onChange,
}: {
  field: CmsFieldConfig;
  filter: CmsFilterConfig;
  value: FilterValue;
  onChange: (value: FilterValue) => void;
}) {
  const label = field.label ?? field.name;
  const operators = enabledFilterOperators(filter);
  const operator = operators.includes(value.operator)
    ? value.operator
    : operators[0];
  const updateValue = (nextValue: string | string[]) =>
    onChange({ operator, value: nextValue });
  const updateOperator = (nextOperator: CmsFilterOperator) =>
    onChange({
      operator: nextOperator,
      value: nextOperator === "exists" ? "true" : "",
    });

  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="grid grid-cols-[116px_minmax(0,1fr)] gap-2">
        <Select value={operator} onValueChange={updateOperator}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {filterOperatorLabel(candidate)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FilterValueControl
          field={field}
          operator={operator}
          value={value.value}
          onChange={updateValue}
        />
      </div>
    </div>
  );
}

function FilterValueControl({
  field,
  operator,
  value,
  onChange,
}: {
  field: CmsFieldConfig;
  operator: CmsFilterOperator;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const valueString = Array.isArray(value) ? value.join(", ") : value;

  if (operator === "exists") {
    return (
      <Select value={valueString || "true"} onValueChange={onChange}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Exists</SelectItem>
          <SelectItem value="false">Missing</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (
    isRelationField(field) &&
    (operator === "equals" || operator === "not_equals" || operator === "in")
  ) {
    return (
      <RelationPicker
        field={{
          ...field,
          type: operator === "in" ? "relationMany" : "relation",
        }}
        value={operator === "in" ? toStringArray(value) : valueString}
        onChange={onChange}
        compact
      />
    );
  }

  if (field.type === "select" && Array.isArray(field.options)) {
    return (
      <Select
        value={valueString || "__any"}
        onValueChange={(next) => onChange(next === "__any" ? "" : next)}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any">Any</SelectItem>
          {field.options.map((option) => {
            const normalized = normalizeOption(option);
            return (
              <SelectItem key={normalized.value} value={normalized.value}>
                {normalized.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "boolean") {
    return (
      <Select
        value={valueString || "__any"}
        onValueChange={(next) => onChange(next === "__any" ? "" : next)}
      >
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__any">Any</SelectItem>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="relative">
      {operator === "contains" ? (
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
      ) : null}
      <Input
        type={filterInputType(field, operator)}
        value={valueString}
        onChange={(event) => onChange(event.target.value)}
        placeholder={operator === "in" ? "Comma values" : "Filter"}
        className={cn("h-9", operator === "contains" ? "pl-8" : "")}
      />
    </div>
  );
}

function DocumentTable({
  collection,
  documents,
  sort,
  onSortChange,
  onOpen,
}: {
  collection: CmsCollectionConfig;
  documents: CmsDocument[];
  sort: CmsSortEntry[];
  onSortChange: (next: CmsSortEntry[]) => void;
  onOpen: (id: string) => void;
}) {
  const fields = listViewFields(collection);
  const idField = collection.source.idField ?? "_id";

  if (documents.length === 0) {
    return <EmptyState title="No items" detail="Try a different filter." />;
  }

  return (
    <div className="w-full min-w-0">
      <div
        className="sticky top-0 z-10 grid border-b border-border bg-background text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        style={{ gridTemplateColumns: tableGrid(fields) }}
      >
        {fields.map(({ field, view }, index) => {
          const sortDirection = sort.find(
            (entry) => entry.field === field.name,
          )?.direction;
          const sortable = isSortableViewField(field, view);
          return (
            <div
              key={field.name}
              className={cn(index === 0 ? "px-4" : "px-3", "py-2")}
            >
              {sortable ? (
                <button
                  type="button"
                  onClick={() => onSortChange(nextSort(sort, field.name))}
                  className="flex min-w-0 items-center gap-1 text-left uppercase hover:text-foreground"
                  title={`Sort by ${view?.label ?? field.label ?? field.name}`}
                >
                  <span className="truncate">
                    {view?.label ?? field.label ?? field.name}
                  </span>
                  {sortDirection === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                  ) : sortDirection === "desc" ? (
                    <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ) : (
                (view?.label ?? field.label ?? field.name)
              )}
            </div>
          );
        })}
      </div>

      {documents.map((document) => {
        const id = getDocumentId(document, idField);

        return (
          <div
            key={id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(id);
              }
            }}
            className="grid w-full border-b border-border text-left transition-colors hover:bg-muted"
            style={{ gridTemplateColumns: tableGrid(fields) }}
          >
            {fields.map(({ field, view }, index) => (
              <div
                key={field.name}
                className={cn(
                  "min-w-0 py-3 text-sm text-foreground",
                  index === 0 ? "px-4 font-medium text-foreground" : "px-3",
                )}
              >
                <ValueInline
                  value={document[field.name]}
                  field={field}
                  view={view}
                />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function DocumentPager({
  total,
  offset,
  limit,
  shown,
  loading,
  onChange,
}: {
  total: number;
  offset: number;
  limit: number;
  shown: number;
  loading: boolean;
  onChange: (offset: number) => void;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + shown, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between">
      <span>
        Showing {start.toLocaleString()}-{end.toLocaleString()} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canPrev || loading}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Prev
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canNext || loading}
          onClick={() => onChange(offset + limit)}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ContentDetailPage({
  collection,
  document,
  editing,
  saving,
  onSubmit,
}: {
  collection: CmsCollectionConfig;
  document: CmsDocument;
  editing: boolean;
  saving: boolean;
  onSubmit: (payload: CmsDocument) => void;
}) {
  const id = getDocumentId(document, collection.source.idField ?? "_id");
  const title = getDocumentTitle(collection, document);
  const updatedAt = getKnownValue(document, [
    "updatedAt",
    "updated_at",
    "modifiedAt",
  ]);
  const fields = detailViewFields(collection);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-border px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{id}</span>
              <span>{collection.label}</span>
              {updatedAt ? <span>Updated {formatDate(updatedAt)}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="fields" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border px-4 py-2 lg:px-6">
          <TabsList className="h-9">
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="fields" className="mt-0">
          {editing ? (
            <ContentFormPage
              collection={collection}
              document={document}
              saving={saving}
              onSubmit={onSubmit}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 lg:p-6 2xl:grid-cols-3">
              {fields.map(({ field, view }) => (
                <FieldPanel
                  key={field.name}
                  field={field}
                  view={view}
                  value={document[field.name]}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="json" className="mt-0">
          <pre className="m-4 overflow-auto rounded border border-border bg-muted p-4 text-xs leading-relaxed text-foreground lg:m-6">
            {JSON.stringify(document, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
}

type CmsFormValue = string | boolean | string[];
type CmsFormValues = Record<string, CmsFormValue>;

function ContentFormPage({
  collection,
  document,
  saving,
  onSubmit,
}: {
  collection: CmsCollectionConfig;
  document?: CmsDocument;
  saving: boolean;
  onSubmit: (payload: CmsDocument) => void;
}) {
  const fields = useMemo(() => formViewFields(collection), [collection]);
  const [values, setValues] = useState<CmsFormValues>(() =>
    buildFormValues(fields, document),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(buildFormValues(fields, document));
    setError(null);
  }, [document, fields]);

  return (
    <form
      className="max-w-4xl space-y-4 p-4 lg:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          setError(null);
          onSubmit(buildFormPayload(fields, values));
        } catch (err) {
          setError(err instanceof Error ? err.message : "Invalid form value.");
        }
      }}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {fields.map(({ field, view }) => (
          <FormFieldControl
            key={field.name}
            field={field}
            view={view}
            value={values[field.name] ?? ""}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))
            }
          />
        ))}
      </div>

      {error ? (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </form>
  );
}

function FormFieldControl({
  field,
  view,
  value,
  onChange,
}: {
  field: CmsFieldConfig;
  view?: CmsViewFieldConfig;
  value: CmsFormValue;
  onChange: (value: CmsFormValue) => void;
}) {
  const label = view?.label ?? field.label ?? field.name;
  const options = field.options?.map(normalizeOption) ?? [];

  if (field.type === "boolean") {
    return (
      <label className="space-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Select
          value={String(value)}
          onValueChange={(next) => onChange(next === "true")}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">True</SelectItem>
            <SelectItem value="false">False</SelectItem>
          </SelectContent>
        </Select>
      </label>
    );
  }

  if (field.type === "select" && options.length > 0) {
    return (
      <label className="space-y-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Select value={String(value)} onValueChange={(next) => onChange(next)}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  if (field.type === "multiSelect" && options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => {
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-sm text-foreground"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    onChange(
                      next
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  if (isRelationField(field)) {
    return (
      <div
        className={cn(
          "space-y-1",
          field.type === "relationMany" ? "lg:col-span-2" : "",
        )}
      >
        <div className="text-sm font-medium text-foreground">{label}</div>
        <RelationPicker field={field} value={value} onChange={onChange} />
      </div>
    );
  }

  if (["textarea", "json", "object", "array"].includes(field.type)) {
    return (
      <label className="space-y-1 lg:col-span-2">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Textarea
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-28"
        />
      </label>
    );
  }

  return (
    <label className="space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <Input
        type={
          field.type === "number"
            ? "number"
            : field.type === "date"
              ? "datetime-local"
              : "text"
        }
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        className="h-9"
      />
    </label>
  );
}

function RelationPicker({
  field,
  value,
  onChange,
  compact = false,
}: {
  field: CmsFieldConfig;
  value: CmsFormValue | string | string[];
  onChange: (value: string | string[]) => void;
  compact?: boolean;
}) {
  const relationContext = useContext(CmsRelationContext);
  const [query, setQuery] = useState("");
  const targetCollection = relationContext?.collections.find(
    (collection) => collection.name === field.target,
  );
  const multiple = field.type === "relationMany";
  const selectedIds = multiple
    ? toStringArray(value)
    : toStringArray(value).slice(0, 1);
  const relationSearch = useMemo(
    () => buildRelationSearchQuery(targetCollection, field, query),
    [field, query, targetCollection],
  );
  const relationOptionsQuery = useQuery({
    queryKey: [
      "cms-relation-options",
      relationContext?.scope ?? "",
      targetCollection?.name ?? null,
      field.name,
      query,
      JSON.stringify(relationSearch),
    ],
    queryFn: () =>
      fetchCmsDocuments(
        relationContext?.headers ?? {},
        targetCollection?.name ?? "",
        {},
        relationSearch,
        targetCollection?.defaultSort ?? [],
        20,
        0,
      ),
    enabled: Boolean(relationContext && targetCollection),
  });

  if (!targetCollection) {
    return (
      <Input
        value={multiple ? selectedIds.join(", ") : (selectedIds[0] ?? "")}
        onChange={(event) =>
          onChange(
            multiple ? splitListValue(event.target.value) : event.target.value,
          )
        }
        className="h-9"
      />
    );
  }

  const optionDocs = filterRelationOptions(
    targetCollection,
    field,
    relationOptionsQuery.data?.docs ?? [],
    query,
    relationSearch,
  );
  const selectedSet = new Set(selectedIds);

  const selectId = (id: string) => {
    if (multiple) {
      onChange(
        selectedSet.has(id)
          ? selectedIds.filter((item) => item !== id)
          : [...selectedIds, id],
      );
      return;
    }
    onChange(id);
  };

  const clearId = (id: string) => {
    if (multiple) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange("");
  };

  return (
    <div
      className={cn(
        "rounded border border-border bg-card",
        compact ? "p-2" : "p-3",
      )}
    >
      <div className="flex flex-wrap gap-1.5">
        {selectedIds.length > 0 ? (
          selectedIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => clearId(id)}
              className="flex max-w-full items-center gap-1 rounded bg-primary/10 px-2 py-1 text-left text-xs text-primary hover:bg-primary/15"
              title="Remove"
            >
              <div className="min-w-0 flex-1">
                <RelationValue value={id} field={field} compact />
              </div>
              <X className="h-3 w-3 shrink-0" />
            </button>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No selection</span>
        )}
      </div>

      <div className={cn("relative", selectedIds.length > 0 ? "mt-2" : "mt-1")}>
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${targetCollection.label}`}
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-2 max-h-52 overflow-auto rounded border border-border">
        {relationOptionsQuery.isLoading ? (
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </div>
        ) : optionDocs.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No matches
          </div>
        ) : (
          optionDocs.map((document) => {
            const id = relationOptionId(targetCollection, field, document);
            if (!id) return null;
            const selected = selectedSet.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectId(id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-2 py-2 text-left text-sm last:border-b-0 hover:bg-muted",
                  selected ? "text-primary" : "text-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    {relationLabel(targetCollection, field, document, id)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-muted-foreground">
                    {id}
                  </span>
                </span>
                {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function FieldPanel({
  field,
  view,
  value,
}: {
  field: CmsFieldConfig;
  view?: CmsViewFieldConfig;
  value: unknown;
}) {
  return (
    <div className="min-w-0 rounded border border-border bg-card p-4">
      <div className="truncate text-sm font-medium text-foreground">
        {view?.label ?? field.label ?? field.name}
      </div>

      <div className="mt-3">
        <ValueBlock value={value} field={field} />
      </div>
    </div>
  );
}

function CmsSetupPanel({
  repoName,
  loading,
  error,
  onSubmit,
}: {
  repoName: string;
  loading: boolean;
  error: string | null;
  onSubmit: (payload: CmsSetupPayload) => void;
}) {
  const [form, setForm] = useState<CmsSetupPayload>({
    name: `${repoName} CMS`,
    databaseUriSecret: "DATABASE_URL",
    databaseName: "",
    collectionName: "",
    collectionLabel: "",
    idField: "_id",
    titleField: "title",
  });

  useEffect(() => {
    setForm((current) => ({
      ...current,
      name: current.name || `${repoName} CMS`,
    }));
  }, [repoName]);

  const canSubmit =
    form.name.trim() &&
    form.databaseUriSecret.trim() &&
    form.collectionName.trim() &&
    form.idField.trim() &&
    form.titleField.trim();

  return (
    <form
      className="w-full max-w-2xl rounded border border-border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || loading) return;
        onSubmit({
          ...form,
          name: form.name.trim(),
          databaseUriSecret: form.databaseUriSecret.trim(),
          databaseName: form.databaseName.trim(),
          collectionName: form.collectionName.trim(),
          collectionLabel: form.collectionLabel.trim(),
          idField: form.idField.trim(),
          titleField: form.titleField.trim(),
        });
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-medium text-foreground">
            CMS is not configured
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Create a read-only Mongo CMS config in the state repo.
          </div>
        </div>
        <Database className="h-5 w-5 shrink-0 text-primary" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <CmsSetupInput
          label="CMS name"
          value={form.name}
          onChange={(name) => setForm((current) => ({ ...current, name }))}
        />
        <CmsSetupInput
          label="Database secret"
          value={form.databaseUriSecret}
          onChange={(databaseUriSecret) =>
            setForm((current) => ({ ...current, databaseUriSecret }))
          }
        />
        <CmsSetupInput
          label="Database name (optional)"
          value={form.databaseName}
          onChange={(databaseName) =>
            setForm((current) => ({ ...current, databaseName }))
          }
        />
        <CmsSetupInput
          label="Collection"
          value={form.collectionName}
          onChange={(collectionName) =>
            setForm((current) => ({
              ...current,
              collectionName,
              collectionLabel: current.collectionLabel || collectionName,
            }))
          }
        />
        <CmsSetupInput
          label="Collection label"
          value={form.collectionLabel}
          onChange={(collectionLabel) =>
            setForm((current) => ({ ...current, collectionLabel }))
          }
        />
        <CmsSetupInput
          label="ID field"
          value={form.idField}
          onChange={(idField) =>
            setForm((current) => ({ ...current, idField }))
          }
        />
        <CmsSetupInput
          label="Title field"
          value={form.titleField}
          onChange={(titleField) =>
            setForm((current) => ({ ...current, titleField }))
          }
        />
      </div>

      {error ? (
        <div className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-end">
        <Button type="submit" disabled={!canSubmit || loading}>
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Configure CMS
        </Button>
      </div>
    </form>
  );
}

function CmsSetupInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9"
      />
    </label>
  );
}

function buildFormValues(
  fields: ResolvedViewField[],
  document?: CmsDocument,
): CmsFormValues {
  const values: CmsFormValues = {};

  for (const { field } of fields) {
    const value = document?.[field.name];

    if (field.type === "boolean") {
      values[field.name] = Boolean(value);
      continue;
    }

    if (field.type === "multiSelect" && Array.isArray(value)) {
      values[field.name] = value.map((item) => String(item));
      continue;
    }

    if (field.type === "relationMany") {
      values[field.name] = Array.isArray(value)
        ? value
            .map((item) => relationId(item, field))
            .filter((item): item is string => Boolean(item))
        : [];
      continue;
    }

    if (field.type === "relation") {
      values[field.name] = relationId(value, field) ?? "";
      continue;
    }

    if (field.type === "date") {
      values[field.name] = toDateTimeLocalValue(value);
      continue;
    }

    if (["json", "object", "array"].includes(field.type)) {
      values[field.name] =
        value === undefined ? "" : JSON.stringify(value, null, 2);
      continue;
    }

    if (Array.isArray(value)) {
      values[field.name] = value
        .map((item) => formatShortValue(item))
        .join(", ");
      continue;
    }

    values[field.name] = value == null ? "" : String(value);
  }

  return values;
}

function buildFormPayload(
  fields: ResolvedViewField[],
  values: CmsFormValues,
): CmsDocument {
  const payload: CmsDocument = {};

  for (const { field } of fields) {
    const value = values[field.name];

    if (isBlankFormValue(value)) {
      if (field.required)
        throw new Error(`${field.label ?? field.name} is required.`);
      continue;
    }

    payload[field.name] = parseFormValue(field, value);
  }

  return payload;
}

function parseFormValue(field: CmsFieldConfig, value: CmsFormValue): unknown {
  if (field.type === "boolean") return Boolean(value);
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${field.label ?? field.name} must be a number.`);
    }
    return parsed;
  }
  if (field.type === "date") {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`${field.label ?? field.name} must be a date.`);
    }
    return date.toISOString();
  }
  if (["json", "object", "array"].includes(field.type)) {
    try {
      return JSON.parse(String(value));
    } catch {
      throw new Error(`${field.label ?? field.name} must be valid JSON.`);
    }
  }
  if (field.type === "multiSelect") {
    return Array.isArray(value) ? value : splitListValue(value);
  }
  if (field.type === "relationMany") {
    return splitListValue(value);
  }
  return String(value);
}

function splitListValue(value: CmsFormValue): string[] {
  return Array.isArray(value)
    ? value
    : String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  if (typeof value === "string") return splitListValue(value);
  if (value === null || value === undefined || value === false) return [];
  return [String(value)];
}

function isBlankFormValue(value: CmsFormValue | undefined): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value === undefined || value === "";
}

function toDateTimeLocalValue(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function ValueInline({
  value,
  field,
  view,
}: {
  value: unknown;
  field: CmsFieldConfig;
  view?: CmsViewFieldConfig;
}) {
  if (isEmptyValue(value))
    return <span className="text-muted-foreground">-</span>;

  if (view?.display === "count" && Array.isArray(value)) {
    return (
      <span className="block truncate">{value.length.toLocaleString()}</span>
    );
  }

  if (view?.display === "json") {
    return <span className="text-muted-foreground">JSON</span>;
  }

  if (isRelationField(field)) {
    return <RelationValue value={value} field={field} compact />;
  }

  if (field.type === "boolean") {
    return <BooleanBadge value={Boolean(value)} />;
  }

  if (
    field.type === "date" ||
    view?.format === "date" ||
    view?.format === "datetime"
  ) {
    return <span className="block truncate">{formatDate(value)}</span>;
  }

  if (Array.isArray(value)) {
    return (
      <span className="block truncate">
        {value.map((item) => formatShortValue(item)).join(", ")}
      </span>
    );
  }

  if (typeof value === "object") {
    return <span className="text-muted-foreground">JSON</span>;
  }

  return <span className="block truncate">{String(value)}</span>;
}

function ValueBlock({
  value,
  field,
}: {
  value: unknown;
  field: CmsFieldConfig;
}) {
  if (isEmptyValue(value))
    return <div className="text-sm text-muted-foreground">-</div>;

  if (isRelationField(field)) {
    return <RelationValue value={value} field={field} compact={false} />;
  }

  if (field.type === "boolean") {
    return <BooleanBadge value={Boolean(value)} />;
  }

  if (field.type === "date") {
    return <div className="text-sm text-foreground">{formatDate(value)}</div>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {value.slice(0, 20).map((item, index) => (
          <Badge
            key={`${String(item)}-${index}`}
            variant="secondary"
            className="max-w-full rounded bg-muted text-foreground"
          >
            <span className="truncate">{formatShortValue(item)}</span>
          </Badge>
        ))}
        {value.length > 20 ? (
          <Badge
            variant="secondary"
            className="rounded bg-muted text-muted-foreground"
          >
            +{value.length - 20}
          </Badge>
        ) : null}
      </div>
    );
  }

  if (typeof value === "object") {
    return (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <div className="break-words text-sm text-foreground">{String(value)}</div>
  );
}

function RelationValue({
  value,
  field,
  compact,
}: {
  value: unknown;
  field: CmsFieldConfig;
  compact: boolean;
}) {
  const items = Array.isArray(value) ? value : [value];
  const visibleItems = items.slice(0, compact ? 2 : 20);
  const hiddenCount = items.length - visibleItems.length;

  if (items.length === 0) {
    return compact ? (
      <span className="text-muted-foreground">-</span>
    ) : (
      <div className="text-sm text-muted-foreground">-</div>
    );
  }

  return (
    <div
      className={cn(
        compact ? "flex min-w-0 flex-wrap gap-1.5" : "flex flex-wrap gap-1.5",
      )}
    >
      {visibleItems.map((item, index) => (
        <RelationLink
          key={`${relationId(item, field) ?? String(item)}-${index}`}
          value={item}
          field={field}
          compact={compact}
        />
      ))}
      {hiddenCount > 0 ? (
        <Badge
          variant="secondary"
          className="rounded bg-muted text-muted-foreground"
        >
          +{hiddenCount}
        </Badge>
      ) : null}
    </div>
  );
}

function RelationLink({
  value,
  field,
  compact,
}: {
  value: unknown;
  field: CmsFieldConfig;
  compact: boolean;
}) {
  const router = useRouter();
  const relationContext = useContext(CmsRelationContext);
  const targetCollection = relationContext?.collections.find(
    (collection) => collection.name === field.target,
  );
  const id = relationId(value, field);

  const relationQuery = useQuery({
    queryKey: ["cms-relation", field.target, id],
    queryFn: () =>
      fetchCmsDocument(
        relationContext?.headers ?? {},
        targetCollection?.name ?? "",
        id ?? "",
      ),
    enabled: Boolean(relationContext && targetCollection && id),
    staleTime: 60_000,
  });

  const label =
    targetCollection && relationQuery.data
      ? relationLabel(targetCollection, field, relationQuery.data, id)
      : formatShortValue(value);

  if (!targetCollection || !id) {
    return <RelationFallback value={label} compact={compact} />;
  }

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        router.push(
          `/cms/${encodeURIComponent(targetCollection.name)}/${encodeURIComponent(id)}`,
        );
      }}
      className={cn(
        "max-w-full rounded bg-primary/10 text-left text-primary transition-colors hover:bg-primary/15",
        compact ? "px-1.5 py-0 text-[11px]" : "px-2 py-1 text-sm",
      )}
      title={id}
    >
      <span className="block truncate">
        {relationQuery.isLoading ? formatShortValue(value) : label}
      </span>
      {!compact && id !== label ? (
        <span className="mt-0.5 block truncate font-mono text-[10px] text-primary/70">
          {id}
        </span>
      ) : null}
    </button>
  );
}

function RelationFallback({
  value,
  compact,
}: {
  value: string;
  compact: boolean;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "max-w-full rounded bg-muted text-foreground/55",
        compact ? "px-1.5 py-0 text-[11px]" : "px-2 py-1 text-sm",
      )}
      title={value}
    >
      <span className="truncate">{value}</span>
    </Badge>
  );
}

function BooleanBadge({ value }: { value: boolean }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "rounded px-1.5 py-0 text-[11px]",
        value ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {value ? "true" : "false"}
    </Badge>
  );
}

function LoadingRows() {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center px-4 py-8 text-center">
      <div className="text-sm font-medium text-foreground/55">{title}</div>
      {detail ? (
        <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

function buildFilters(
  collection: CmsCollectionConfig | null,
  values: FilterValues,
): Record<string, Record<string, unknown>> {
  if (!collection) return {};
  const result: Record<string, Record<string, unknown>> = {};

  for (const filter of collection.filters) {
    const filterValue = values[filter.field];
    if (!filterValue || isBlankFilterValue(filterValue.value)) continue;

    const operators = enabledFilterOperators(filter);
    const operator = operators.includes(filterValue.operator)
      ? filterValue.operator
      : operators[0];
    const value =
      operator === "in" ? toStringArray(filterValue.value) : filterValue.value;

    result[filter.field] = { [operator]: value };
  }

  return result;
}

function defaultFilterValue(filter: CmsFilterConfig): FilterValue {
  const operator = enabledFilterOperators(filter)[0];
  return {
    operator,
    value: operator === "exists" ? "true" : "",
  };
}

function enabledFilterOperators(filter: CmsFilterConfig): CmsFilterOperator[] {
  return filter.operators && filter.operators.length > 0
    ? filter.operators
    : ["equals"];
}

function filterOperatorLabel(operator: CmsFilterOperator): string {
  if (operator === "not_equals") return "not";
  if (operator === "greater_than") return ">";
  if (operator === "greater_than_equal") return ">=";
  if (operator === "less_than") return "<";
  if (operator === "less_than_equal") return "<=";
  return operator;
}

function filterInputType(
  field: CmsFieldConfig,
  operator: CmsFilterOperator,
): string {
  if (operator === "contains" || operator === "in") return "text";
  if (field.type === "number") return "number";
  if (field.type === "date") return "datetime-local";
  return "text";
}

function isBlankFilterValue(value: string | string[]): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

function serializeSort(sort: CmsSortEntry[]): string {
  return sort
    .filter((entry) => entry.field)
    .map(
      (entry) => `${entry.field}:${entry.direction === "asc" ? "asc" : "desc"}`,
    )
    .join(",");
}

function nextSort(sort: CmsSortEntry[], field: string): CmsSortEntry[] {
  const current = sort.find((entry) => entry.field === field);
  if (!current) return [{ field, direction: "asc" }];
  if (current.direction === "asc") return [{ field, direction: "desc" }];
  return [];
}

function isSortableViewField(
  field: CmsFieldConfig,
  view?: CmsViewFieldConfig,
): boolean {
  if (view?.sortable !== undefined) return view.sortable;
  return !["array", "json", "object", "relationMany", "multiSelect"].includes(
    field.type,
  );
}

function buildRelationSearchQuery(
  targetCollection: CmsCollectionConfig | undefined,
  field: CmsFieldConfig,
  query: string,
): CmsSearchQuery | undefined {
  const trimmed = query.trim();
  if (!targetCollection || !trimmed) return undefined;
  const fields = relationSearchFields(targetCollection, field);
  return fields.length > 0 ? { query: trimmed, fields } : undefined;
}

function filterRelationOptions(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  documents: CmsDocument[],
  query: string,
  serverSearch: CmsSearchQuery | undefined,
): CmsDocument[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || serverSearch) return documents;
  return documents.filter((document) => {
    const id = relationOptionId(targetCollection, field, document);
    const label = relationLabel(targetCollection, field, document, id);
    return (
      label.toLowerCase().includes(trimmed) ||
      (id ? id.toLowerCase().includes(trimmed) : false)
    );
  });
}

function relationSearchFields(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
): string[] {
  const fields = [
    field.labelField,
    ...targetCollection.searchFields,
    targetCollection.titleField,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(fields)];
}

function relationOptionId(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  document: CmsDocument,
): string {
  const idField = field.valueField ?? targetCollection.source.idField ?? "_id";
  return getDocumentId(document, idField);
}

async function fetchCmsConfig(
  headers: Record<string, string>,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", { headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

async function setupCms(
  headers: Record<string, string>,
  payload: CmsSetupPayload,
): Promise<CmsConfigState> {
  const res = await fetch("/api/kody/cms", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsIndexResponse;
  if (!res.ok || !json.cms) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.cms;
}

async function fetchCmsDocuments(
  headers: Record<string, string>,
  collection: string,
  filters: Record<string, Record<string, unknown>>,
  search: CmsSearchQuery | undefined,
  sort: CmsSortEntry[],
  limit: number,
  offset: number,
): Promise<CmsListResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });

  if (Object.keys(filters).length > 0) {
    params.set("filters", JSON.stringify(filters));
  }
  if (search?.query) {
    params.set("q", search.query);
    if (search.fields?.length) {
      params.set("searchFields", search.fields.join(","));
    }
  }
  if (sort.length > 0) {
    params.set("sort", serializeSort(sort));
  }

  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}?${params.toString()}`,
    { headers, cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as CmsListResult & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json;
}

async function fetchCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
): Promise<CmsDocument> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { headers, cache: "no-store" },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

async function createCmsDocument(
  headers: Record<string, string>,
  collection: string,
  payload: CmsDocument,
): Promise<CmsDocument> {
  const res = await fetch(`/api/kody/cms/${encodeURIComponent(collection)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

async function updateCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
  payload: CmsDocument,
): Promise<CmsDocument> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDocumentResponse;
  if (!res.ok || !json.document) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.document;
}

async function deleteCmsDocument(
  headers: Record<string, string>,
  collection: string,
  id: string,
): Promise<boolean> {
  const res = await fetch(
    `/api/kody/cms/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers,
      cache: "no-store",
    },
  );
  const json = (await res.json().catch(() => ({}))) as CmsDeleteResponse;
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return Boolean(json.deleted);
}

function visibleFields(collection: CmsCollectionConfig): CmsFieldConfig[] {
  return collection.fields.filter((field) => !field.hidden);
}

interface ResolvedViewField {
  field: CmsFieldConfig;
  view?: CmsViewFieldConfig;
}

function listViewFields(collection: CmsCollectionConfig): ResolvedViewField[] {
  const configured = resolveConfiguredViewFields(
    collection,
    collection.views?.list?.fields,
  );
  if (configured.length > 0) return configured;

  if (collection.listFields?.length) {
    const legacy = resolveConfiguredViewFields(
      collection,
      collection.listFields.map((name, index) => ({
        name,
        role: index === 0 ? "primary" : "secondary",
      })),
    );
    if (legacy.length > 0) return legacy;
  }

  const fields = visibleFields(collection);
  const idField = collection.source.idField ?? "_id";
  const titleField = collection.titleField;
  const primary =
    fields.find((field) => field.name === titleField) ??
    fields.find((field) => field.name !== idField) ??
    fields[0];

  const secondary = fields
    .filter(
      (field) =>
        field.name !== primary?.name &&
        field.name !== idField &&
        isCompactListField(field),
    )
    .slice(0, 3);

  return primary
    ? [primary, ...secondary].map((field, index) => ({
        field,
        view: { name: field.name, role: index === 0 ? "primary" : "secondary" },
      }))
    : [];
}

function detailViewFields(
  collection: CmsCollectionConfig,
): ResolvedViewField[] {
  const configured = resolveConfiguredViewFields(
    collection,
    collection.views?.detail?.fields,
  );
  if (configured.length > 0) return configured;
  return visibleFields(collection).map((field) => ({ field }));
}

function formViewFields(collection: CmsCollectionConfig): ResolvedViewField[] {
  const configured = resolveConfiguredViewFields(
    collection,
    collection.views?.form?.fields,
  );
  if (configured.length > 0)
    return configured.filter(({ field }) => isWritableField(collection, field));
  return visibleFields(collection)
    .filter((field) => isWritableField(collection, field))
    .map((field) => ({ field }));
}

function resolveConfiguredViewFields(
  collection: CmsCollectionConfig,
  viewFields: CmsViewFieldConfig[] | undefined,
): ResolvedViewField[] {
  if (!viewFields?.length) return [];
  const fieldByName = new Map(
    visibleFields(collection).map((field) => [field.name, field]),
  );
  return viewFields.flatMap((view) => {
    const field = fieldByName.get(view.name);
    return field ? [{ field, view }] : [];
  });
}

function isWritableField(
  collection: CmsCollectionConfig,
  field: CmsFieldConfig,
): boolean {
  const idField = collection.source.idField ?? "_id";
  return (
    !field.hidden &&
    !field.readOnly &&
    field.type !== "id" &&
    field.name !== idField
  );
}

function isCompactListField(field: CmsFieldConfig): boolean {
  return !["array", "json", "object", "textarea"].includes(field.type);
}

function tableGrid(fields: ResolvedViewField[]): string {
  return fields
    .map(({ view }, index) => {
      if (view?.width === "xs") return "minmax(64px, 0.5fr)";
      if (view?.width === "sm") return "minmax(96px, 0.8fr)";
      if (view?.width === "lg") return "minmax(180px, 1.4fr)";
      if (view?.width === "fill") return "minmax(180px, 2fr)";
      return index === 0 ? "minmax(150px, 1.8fr)" : "minmax(96px, 1fr)";
    })
    .join(" ");
}

function getDocumentId(document: CmsDocument, idField: string): string {
  return String(document[idField] ?? document.id ?? "");
}

function getDocumentTitle(
  collection: CmsCollectionConfig,
  document: CmsDocument,
): string {
  const titleField = collection.titleField;
  if (titleField && !isEmptyValue(document[titleField])) {
    return String(document[titleField]);
  }

  const id = getDocumentId(document, collection.source.idField ?? "_id");
  return id || "Untitled";
}

function getKnownValue(
  document: CmsDocument,
  names: string[],
): unknown | undefined {
  for (const name of names) {
    if (!isEmptyValue(document[name])) return document[name];
  }
  return undefined;
}

function normalizeOption(option: string | CmsFieldOption): CmsFieldOption {
  return typeof option === "string" ? { label: option, value: option } : option;
}

function isRelationField(field: CmsFieldConfig): boolean {
  return field.type === "relation" || field.type === "relationMany";
}

function relationId(value: unknown, field: CmsFieldConfig): string | null {
  if (isEmptyValue(value)) return null;

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const configuredValue =
      field.valueField && !isEmptyValue(record[field.valueField])
        ? record[field.valueField]
        : undefined;
    const id = configuredValue ?? record.id ?? record._id;
    return isEmptyValue(id) ? null : String(id);
  }

  return String(value);
}

function relationLabel(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  document: CmsDocument,
  fallbackId: string | null,
): string {
  const labelField = field.labelField ?? targetCollection.titleField;
  if (labelField && !isEmptyValue(document[labelField])) {
    return String(document[labelField]);
  }

  return (
    getDocumentTitle(targetCollection, document) || fallbackId || "Linked item"
  );
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatShortValue(value: unknown): string {
  if (isEmptyValue(value)) return "-";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "object") {
    if (isObjectWithId(value)) return String(value.id ?? value._id);
    return "JSON";
  }
  return String(value);
}

function isObjectWithId(
  value: unknown,
): value is { id?: unknown; _id?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("id" in value || "_id" in value)
  );
}
