"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { AuthGuard } from "@dashboard/lib/auth-guard";
import { buildAuthHeaders, useAuth } from "@dashboard/lib/auth-context";
import { useMediaQuery } from "@dashboard/lib/hooks/useMediaQuery";
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

import { ConfirmDialog } from "./ConfirmDialog";
import { PageHeader } from "./PageShell";
import {
  createCmsConfig,
  createCmsDocument,
  deleteCmsDocument,
  fetchCmsAdapters,
  fetchCmsConfig,
  fetchCmsDocument,
  fetchCmsDocuments,
  fetchCmsDocumentsByIds,
  generateCmsSchema,
  saveCmsPermissions,
  updateCmsDocument,
  type CmsAdapterCatalogItem,
  type GenerateCmsSchemaPayload,
  type SaveCmsPermissionsPayload,
} from "./cms/client";
import { canWriteOperation, writeDisabledReason } from "./cms/operations";
import { cmsDocumentEditPath, cmsDocumentPath } from "./cms/paths";
import { selectionPath } from "../selection-routing";
import { generateCmsMcpTools } from "@dashboard/lib/cms/mcp";
import { assertCmsFieldValue } from "@dashboard/lib/cms/validation";
import type {
  CmsCollectionConfig,
  CmsContentOperation,
  CmsDocument,
  CmsFieldConfig,
  CmsFieldOption,
  CmsFilterConfig,
  CmsFilterOperator,
  CmsPermissionsConfig,
  CmsPublicConfig,
  CmsRole,
  CmsSearchQuery,
  CmsSortEntry,
  CmsViewFieldConfig,
} from "../cms/types";

const PAGE_SIZE = 25;
const DEFAULT_CMS_ADAPTER = "mongodb";
const DEFAULT_CMS_ADAPTERS: CmsAdapterCatalogItem[] = [
  {
    name: DEFAULT_CMS_ADAPTER,
    label: "MongoDB",
    description: "MongoDB collections",
    supportsSchemaGeneration: true,
    htmlUrl: null,
  },
];

type FilterValue = {
  operator: CmsFilterOperator;
  value: string | string[];
};

type FilterValues = Record<string, FilterValue>;

interface CmsRelationBatch {
  collection: CmsCollectionConfig;
  ids: string[];
}

interface CmsRelationContextValue {
  headers: Record<string, string>;
  collections: CmsCollectionConfig[];
  scope: string;
  relationDocuments?: Map<string, CmsDocument>;
  batchedRelationKeys?: Set<string>;
}

const CmsRelationContext = createContext<CmsRelationContextValue | null>(null);

function relationDocumentCacheKey(collection: string, id: string): string {
  return `${collection}\u001f${id}`;
}

export function CmsManager({
  selectedCollectionName = null,
}: {
  selectedCollectionName?: string | null;
} = {}) {
  return (
    <AuthGuard>
      <CmsListPage selectedCollectionName={selectedCollectionName} />
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
      <CmsItemPage
        collectionName={collectionName}
        documentId={documentId}
        editMode={false}
      />
    </AuthGuard>
  );
}

export function CmsEditManager({
  collectionName,
  documentId,
}: {
  collectionName: string;
  documentId: string;
}) {
  return (
    <AuthGuard>
      <CmsItemPage
        collectionName={collectionName}
        documentId={documentId}
        editMode
      />
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

function CmsListPage({
  selectedCollectionName = null,
}: {
  selectedCollectionName?: string | null;
} = {}) {
  const router = useRouter();
  const autoSelectFirst = useMediaQuery("(min-width: 1024px)");
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const cmsQueryKey = ["cms-config", scope] as const;

  const [collectionSearch, setCollectionSearch] = useState("");
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [sort, setSort] = useState<CmsSortEntry[]>([]);
  const [offset, setOffset] = useState(0);
  const [selectedAdapter, setSelectedAdapter] = useState(DEFAULT_CMS_ADAPTER);
  const [schemaGenerationRequest, setSchemaGenerationRequest] = useState<{
    refresh?: boolean;
  } | null>(null);

  const cmsQuery = useQuery({
    queryKey: cmsQueryKey,
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });
  const adaptersQuery = useQuery({
    queryKey: [
      "cms-adapters",
      scope,
      auth?.storeRepoUrl ?? null,
      auth?.storeRef ?? null,
    ],
    queryFn: () => fetchCmsAdapters(headers),
    enabled: Boolean(auth),
  });
  const createConfigMutation = useMutation({
    mutationFn: () =>
      createCmsConfig(headers, {
        name: `${auth?.repo ?? "Repo"} CMS`,
        adapter: selectedAdapter,
      }),
    onSuccess: async (cms) => {
      queryClient.setQueryData(cmsQueryKey, cms);
      await queryClient.invalidateQueries({ queryKey: cmsQueryKey });
    },
  });
  const generateSchemaMutation = useMutation({
    mutationFn: (options?: { refresh?: boolean }) =>
      generateCmsSchema(
        headers,
        buildGenerateSchemaPayload(auth?.repo, options),
      ),
    onSuccess: async (cms) => {
      queryClient.setQueryData(cmsQueryKey, cms);
      await queryClient.invalidateQueries({ queryKey: cmsQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["cms-documents"] });
    },
  });
  const savePermissionsMutation = useMutation({
    mutationFn: (payload: SaveCmsPermissionsPayload) =>
      saveCmsPermissions(headers, payload),
    onSuccess: async (cms) => {
      queryClient.setQueryData(cmsQueryKey, cms);
      await queryClient.invalidateQueries({ queryKey: cmsQueryKey });
    },
  });

  const cmsConfigured = cmsQuery.data?.configured !== false;
  const collections = useMemo(
    () => (cmsConfigured ? (cmsQuery.data?.collections ?? []) : []),
    [cmsConfigured, cmsQuery.data?.collections],
  );
  const cmsLoaded = cmsQuery.data !== undefined;
  const adapters =
    adaptersQuery.data && adaptersQuery.data.length > 0
      ? adaptersQuery.data
      : DEFAULT_CMS_ADAPTERS;
  const currentCmsAdapter =
    cmsQuery.data?.configured === true
      ? (cmsQuery.data.defaultAdapter ?? DEFAULT_CMS_ADAPTER)
      : selectedAdapter;
  const currentAdapter = findCmsAdapter(adapters, currentCmsAdapter);
  const schemaGenerationSupported =
    currentAdapter?.supportsSchemaGeneration === true ||
    currentCmsAdapter === DEFAULT_CMS_ADAPTER;

  const selectedCollection = selectedCollectionName
    ? (collections.find(
        (collection) => collection.name === selectedCollectionName,
      ) ?? null)
    : null;

  useEffect(() => {
    if (!adaptersQuery.data?.length) return;
    if (
      adaptersQuery.data.some((adapter) => adapter.name === selectedAdapter)
    ) {
      return;
    }
    setSelectedAdapter(adaptersQuery.data[0].name);
  }, [adaptersQuery.data, selectedAdapter]);

  useEffect(() => {
    if (cmsQuery.isLoading || !cmsLoaded) return;
    if (collections.length === 0) {
      if (selectedCollectionName) router.replace("/cms");
      return;
    }
    if (
      selectedCollectionName &&
      !collections.some(
        (collection) => collection.name === selectedCollectionName,
      )
    ) {
      router.replace("/cms");
      return;
    }
    if (!selectedCollectionName && autoSelectFirst) {
      router.replace(selectionPath("/cms", collections[0].name));
    }
  }, [
    autoSelectFirst,
    cmsLoaded,
    cmsQuery.isLoading,
    collections,
    router,
    selectedCollectionName,
  ]);

  const selectCollection = (collectionName: string) => {
    router.push(selectionPath("/cms", collectionName));
  };

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
      : generateSchemaMutation.error instanceof Error
        ? generateSchemaMutation.error.message
        : documentsQuery.error instanceof Error
          ? documentsQuery.error.message
          : null;

  if (cmsQuery.data?.configured === false) {
    return (
      <CmsShell
        title="CMS"
        subtitle="Not configured"
        actions={null}
        error={
          createConfigMutation.error instanceof Error
            ? createConfigMutation.error.message
            : null
        }
      >
        <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-6 md:px-8">
          <UnconfiguredCmsState
            adapters={adapters}
            selectedAdapter={selectedAdapter}
            loading={createConfigMutation.isPending}
            onAdapterChange={setSelectedAdapter}
            onCreate={() => createConfigMutation.mutate()}
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
          ? `${cmsQuery.data.name} / ${cmsQuery.data.environment} / ${
              currentAdapter?.label ?? currentCmsAdapter
            }`
          : undefined
      }
      error={error}
      actions={
        <CmsHeaderActions
          loading={cmsQuery.isFetching || documentsQuery.isFetching}
          schemaLoading={generateSchemaMutation.isPending}
          schemaSupported={schemaGenerationSupported}
          onOpenMcp={() => setMcpOpen(true)}
          onRefresh={() => {
            void cmsQuery.refetch();
            void documentsQuery.refetch();
          }}
          onUpdateSchema={() => setSchemaGenerationRequest({ refresh: true })}
          onOpenPermissions={() => setPermissionsOpen(true)}
        />
      }
    >
      <CmsRelationProvider
        headers={headers}
        collections={collections}
        scope={scope}
      >
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[184px_minmax(0,1fr)]">
          <CollectionRail
            loading={cmsQuery.isLoading}
            collections={collections}
            selectedName={selectedCollection?.name ?? ""}
            search={collectionSearch}
            onSearchChange={setCollectionSearch}
            onSelect={selectCollection}
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
                router.push(cmsDocumentPath(selectedCollection.name, id));
              }}
              generateSchemaError={
                generateSchemaMutation.error instanceof Error
                  ? generateSchemaMutation.error.message
                  : null
              }
              schemaSupported={schemaGenerationSupported}
              adapterLabel={currentAdapter?.label ?? currentCmsAdapter}
              generatingSchema={generateSchemaMutation.isPending}
              onGenerateSchema={() => setSchemaGenerationRequest({})}
              onPageChange={setOffset}
            />
          </main>
        </div>
      </CmsRelationProvider>
      <ConfirmDialog
        open={schemaGenerationRequest !== null}
        title={
          schemaGenerationRequest?.refresh
            ? "Update CMS schema?"
            : "Generate CMS schema?"
        }
        description="Kody will read the connected database and write the generated CMS config into the state repo. Review any state changes before shipping them."
        confirmLabel={
          schemaGenerationRequest?.refresh ? "Update schema" : "Generate schema"
        }
        onClose={() => setSchemaGenerationRequest(null)}
        onConfirm={() =>
          generateSchemaMutation.mutate(schemaGenerationRequest ?? undefined)
        }
      />
      {cmsQuery.data?.configured ? (
        <>
          <CmsMcpDialog
            open={mcpOpen}
            config={cmsQuery.data}
            onOpenChange={setMcpOpen}
          />
          <CmsPermissionsDialog
            open={permissionsOpen}
            config={cmsQuery.data}
            saving={savePermissionsMutation.isPending}
            error={
              savePermissionsMutation.error instanceof Error
                ? savePermissionsMutation.error.message
                : null
            }
            onOpenChange={setPermissionsOpen}
            onSave={(payload) => savePermissionsMutation.mutate(payload)}
          />
        </>
      ) : null}
    </CmsShell>
  );
}

function CmsItemPage({
  collectionName,
  documentId,
  editMode,
}: {
  collectionName: string;
  documentId: string;
  editMode: boolean;
}) {
  const router = useRouter();
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const headers = useMemo(() => buildAuthHeaders(auth), [auth]);
  const scope = `${auth?.owner ?? ""}/${auth?.repo ?? ""}`;
  const [editing, setEditing] = useState(editMode);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const detailPath = cmsDocumentPath(collectionName, documentId);
  const editPath = cmsDocumentEditPath(collectionName, documentId);

  useEffect(() => {
    setEditing(editMode);
  }, [collectionName, documentId, editMode]);

  const cmsQuery = useQuery({
    queryKey: ["cms-config", scope],
    queryFn: () => fetchCmsConfig(headers),
    enabled: Boolean(auth),
  });

  const collections =
    cmsQuery.data?.configured === true ? cmsQuery.data.collections : [];
  const actorRole =
    cmsQuery.data?.configured === true
      ? (cmsQuery.data.actorRole ?? "viewer")
      : "viewer";
  const cmsPermissions =
    cmsQuery.data?.configured === true ? cmsQuery.data.permissions : undefined;
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
      const updatedId =
        collection &&
        getDocumentId(updated, collection.source.idField ?? "_id");
      const nextId = updatedId || documentId;
      queryClient.setQueryData(documentQueryKey, updated);
      queryClient.setQueryData(
        ["cms-document", scope, collectionName, nextId],
        updated,
      );
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["cms-documents"] });
      router.push(cmsDocumentPath(collectionName, nextId));
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
  const editBlockedReason =
    editing &&
    collection &&
    !canWriteOperation(collection, "update", actorRole, cmsPermissions)
      ? writeDisabledReason(collection, "update", actorRole, cmsPermissions)
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
              actorRole={actorRole}
              permissions={cmsPermissions}
              onEdit={() => {
                setEditing(true);
                router.push(editPath);
              }}
              onCancelEdit={() => {
                setEditing(false);
                router.push(detailPath);
              }}
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
            editBlockedReason={editBlockedReason}
            saving={updateMutation.isPending}
            onSubmit={(payload) => updateMutation.mutate(payload)}
            onCancelEdit={() => {
              setEditing(false);
              router.push(detailPath);
            }}
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
  const actorRole =
    cmsQuery.data?.configured === true
      ? (cmsQuery.data.actorRole ?? "viewer")
      : "viewer";
  const cmsPermissions =
    cmsQuery.data?.configured === true ? cmsQuery.data.permissions : undefined;
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
      router.push(cmsDocumentPath(collection.name, id));
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
      ) : !canWriteOperation(
          collection,
          "create",
          actorRole,
          cmsPermissions,
        ) ? (
        <EmptyState
          title="Create unavailable"
          detail={writeDisabledReason(
            collection,
            "create",
            actorRole,
            cmsPermissions,
          )}
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
            onCancel={() => router.push("/cms")}
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
  useCmsViewportGuard();

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

function useCmsViewportGuard() {
  useLayoutEffect(() => {
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousScrollRestoration = window.history.scrollRestoration;
    const resetWindowScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    window.history.scrollRestoration = "manual";
    htmlStyle.overflow = "hidden";
    bodyStyle.overflow = "hidden";
    resetWindowScroll();

    const animationFrame = window.requestAnimationFrame(resetWindowScroll);
    const resetTimers = [50, 250, 1000].map((delay) =>
      window.setTimeout(resetWindowScroll, delay),
    );
    window.addEventListener("scroll", resetWindowScroll, { passive: true });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resetTimers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("scroll", resetWindowScroll);
      htmlStyle.overflow = previousHtmlOverflow;
      bodyStyle.overflow = previousBodyOverflow;
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);
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
  schemaLoading,
  schemaSupported,
  onOpenMcp,
  onRefresh,
  onUpdateSchema,
  onOpenPermissions,
}: {
  loading: boolean;
  schemaLoading: boolean;
  schemaSupported: boolean;
  onOpenMcp: () => void;
  onRefresh: () => void;
  onUpdateSchema: () => void;
  onOpenPermissions: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={onRefresh}
        aria-label="Refresh CMS"
        title="Refresh"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onOpenPermissions}
        aria-label="CMS permissions"
        title="Permissions"
      >
        <ShieldCheck className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onOpenMcp}
        aria-label="CMS MCP"
        title="MCP"
      >
        <Plug className="h-4 w-4" />
      </Button>
      {schemaSupported ? (
        <Button
          variant="outline"
          size="icon"
          disabled={schemaLoading}
          onClick={onUpdateSchema}
          aria-label="Update CMS schema"
          title="Update schema"
        >
          {schemaLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Database className="h-4 w-4" />
          )}
        </Button>
      ) : null}
    </div>
  );
}

type CmsWriteRolePreset = "admin" | "editor";
type CmsPermissionPolicyPreset = "open" | "editorial" | "locked";

type CmsPermissionOperation = Extract<
  CmsContentOperation,
  "create" | "update" | "delete"
>;

const CMS_WRITE_PERMISSION_OPERATIONS: Array<{
  operation: CmsPermissionOperation;
  label: string;
}> = [
  { operation: "create", label: "Create" },
  { operation: "update", label: "Update" },
  { operation: "delete", label: "Delete" },
];

function CmsMcpDialog({
  open,
  config,
  onOpenChange,
}: {
  open: boolean;
  config: CmsPublicConfig;
  onOpenChange: (open: boolean) => void;
}) {
  const endpoint =
    typeof window === "undefined"
      ? "/api/kody/cms/mcp"
      : `${window.location.origin}/api/kody/cms/mcp`;
  const toolCount = generateCmsMcpTools(config).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>CMS MCP</DialogTitle>
          <DialogDescription>
            Schema-generated CMS tools for the current repo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 border-y border-border py-4">
          <div className="grid gap-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Endpoint
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted px-3 py-2 text-sm text-foreground">
                {endpoint}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard?.writeText(endpoint)}
              >
                Copy
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded border border-border bg-muted/40 px-3 py-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Transport
              </div>
              <div className="mt-1 text-sm text-foreground">HTTP</div>
            </div>
            <div className="rounded border border-border bg-muted/40 px-3 py-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Tools
              </div>
              <div className="mt-1 text-sm text-foreground">{toolCount}</div>
            </div>
            <div className="rounded border border-border bg-muted/40 px-3 py-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">
                Collections
              </div>
              <div className="mt-1 text-sm text-foreground">
                {config.collections.length}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              Headers
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {["x-kody-token", "x-kody-owner", "x-kody-repo"].map((header) => (
                <code
                  key={header}
                  className="rounded border border-border bg-muted px-3 py-2 text-sm text-foreground"
                >
                  {header}
                </code>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CMS_PERMISSION_POLICY_PRESETS: Array<{
  value: CmsPermissionPolicyPreset;
  label: string;
  description: string;
  roles: Record<CmsPermissionOperation, CmsWriteRolePreset>;
}> = [
  {
    value: "open",
    label: "Open",
    description: "Editors can create, update, and delete.",
    roles: { create: "editor", update: "editor", delete: "editor" },
  },
  {
    value: "editorial",
    label: "Editorial",
    description: "Editors write content; admins delete.",
    roles: { create: "editor", update: "editor", delete: "admin" },
  },
  {
    value: "locked",
    label: "Locked",
    description: "Only admins can change content.",
    roles: { create: "admin", update: "admin", delete: "admin" },
  },
];

function CmsPermissionsDialog({
  open,
  config,
  saving,
  error,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  config: CmsPublicConfig;
  saving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: SaveCmsPermissionsPayload) => void;
}) {
  const [globalPresets, setGlobalPresets] = useState<
    Record<CmsPermissionOperation, CmsWriteRolePreset>
  >(() => buildGlobalPermissionPresets(config.permissions));
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    buildOverrideState(config.collections),
  );
  const [collectionPresets, setCollectionPresets] = useState<
    Record<string, CmsWriteRolePreset>
  >(() => buildCollectionPermissionPresets(config.collections));
  const [operationFlags, setOperationFlags] = useState<Record<string, boolean>>(
    () => buildCollectionOperationFlags(config.collections),
  );
  const [newOverrideCollection, setNewOverrideCollection] = useState("");

  useEffect(() => {
    if (!open) return;
    setGlobalPresets(buildGlobalPermissionPresets(config.permissions));
    setOverrides(buildOverrideState(config.collections));
    setCollectionPresets(buildCollectionPermissionPresets(config.collections));
    setOperationFlags(buildCollectionOperationFlags(config.collections));
    setNewOverrideCollection("");
  }, [config.collections, config.permissions, open]);

  const updateGlobalPreset = (
    operation: CmsPermissionOperation,
    preset: CmsWriteRolePreset,
  ) => {
    setGlobalPresets((current) => ({ ...current, [operation]: preset }));
  };

  const updateCollectionPreset = (
    collection: string,
    operation: CmsPermissionOperation,
    preset: CmsWriteRolePreset,
  ) => {
    setCollectionPresets((current) => ({
      ...current,
      [permissionPresetKey(collection, operation)]: preset,
    }));
  };
  const updateCollectionOperation = (
    collection: string,
    operation: CmsPermissionOperation,
    enabled: boolean,
  ) => {
    setOperationFlags((current) => ({
      ...current,
      [permissionPresetKey(collection, operation)]: enabled,
    }));
  };
  const applyPolicyPreset = (preset: CmsPermissionPolicyPreset) => {
    const next = CMS_PERMISSION_POLICY_PRESETS.find(
      (item) => item.value === preset,
    )?.roles;
    if (!next) return;
    setGlobalPresets(next);
  };

  const activeOverrideCollections = config.collections.filter(
    (collection) => overrides[collection.name] === true,
  );
  const availableOverrideCollections = config.collections.filter(
    (collection) => overrides[collection.name] !== true,
  );

  const addCollectionOverride = () => {
    if (!newOverrideCollection) return;
    setOverrides((current) => ({
      ...current,
      [newOverrideCollection]: true,
    }));
    setNewOverrideCollection("");
  };

  const removeCollectionOverride = (collectionName: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[collectionName];
      return next;
    });
  };

  const submit = () => {
    onSave({
      permissions: {
        ...config.permissions,
        content: {
          ...config.permissions.content,
          create: rolesForWritePreset(globalPresets.create),
          update: rolesForWritePreset(globalPresets.update),
          delete: rolesForWritePreset(globalPresets.delete),
        },
      },
      collections: config.collections.map((collection) => {
        const enabled = overrides[collection.name] === true;
        return {
          name: collection.name,
          operations: {
            create:
              operationFlags[permissionPresetKey(collection.name, "create")] ??
              collection.operations.create,
            update:
              operationFlags[permissionPresetKey(collection.name, "update")] ??
              collection.operations.update,
            delete:
              operationFlags[permissionPresetKey(collection.name, "delete")] ??
              collection.operations.delete,
          },
          permissions: enabled
            ? {
                ...collection.permissions,
                content: {
                  ...collection.permissions?.content,
                  create: rolesForWritePreset(
                    collectionPresets[
                      permissionPresetKey(collection.name, "create")
                    ] ?? globalPresets.create,
                  ),
                  update: rolesForWritePreset(
                    collectionPresets[
                      permissionPresetKey(collection.name, "update")
                    ] ?? globalPresets.update,
                  ),
                  delete: rolesForWritePreset(
                    collectionPresets[
                      permissionPresetKey(collection.name, "delete")
                    ] ?? globalPresets.delete,
                  ),
                },
              }
            : clearWritePermissionOverrides(collection.permissions),
        };
      }),
    });
  };

  const overrideCount = Object.values(overrides).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>CMS permissions</DialogTitle>
          <DialogDescription>
            Set the default CMS access policy once. Use collection overrides
            only for exceptions.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-border">
          <div className="border-b border-border px-4 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Default policy
                </div>
                <div className="text-xs text-muted-foreground">
                  Apply a preset or tune each write action.
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {CMS_PERMISSION_POLICY_PRESETS.map((preset) => (
                  <Button
                    key={preset.value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto justify-start px-3 py-2 text-left"
                    onClick={() => applyPolicyPreset(preset.value)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm font-medium">
                        {preset.label}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {preset.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              {CMS_WRITE_PERMISSION_OPERATIONS.map((item) => (
                <label key={item.operation} className="space-y-1">
                  <span className="text-xs font-medium uppercase text-muted-foreground">
                    {item.label}
                  </span>
                  <Select
                    value={globalPresets[item.operation]}
                    onValueChange={(value) =>
                      updateGlobalPreset(
                        item.operation,
                        value as CmsWriteRolePreset,
                      )
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admins</SelectItem>
                      <SelectItem value="editor">Editors</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-border px-4 py-4">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium text-foreground">
                Collection write actions
              </div>
              <div className="text-xs text-muted-foreground">
                Enable the actions each collection supports. Role rules below
                decide who can use enabled actions.
              </div>
            </div>
            <div className="mt-3 overflow-x-auto border-y border-border">
              <div className="grid min-w-[560px] grid-cols-[minmax(180px,1fr)_120px_120px_120px] bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <div>Collection</div>
                {CMS_WRITE_PERMISSION_OPERATIONS.map((item) => (
                  <div key={item.operation}>{item.label}</div>
                ))}
              </div>
              {config.collections.map((collection) => (
                <div
                  key={collection.name}
                  className="grid min-w-[560px] grid-cols-[minmax(180px,1fr)_120px_120px_120px] items-center border-t border-border px-3 py-3"
                >
                  <div className="min-w-0 pr-4">
                    <div className="truncate text-sm font-medium text-foreground">
                      {collection.label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {collection.name}
                    </div>
                  </div>
                  {CMS_WRITE_PERMISSION_OPERATIONS.map((item) => {
                    const key = permissionPresetKey(
                      collection.name,
                      item.operation,
                    );
                    const enabled =
                      operationFlags[key] ??
                      collection.operations[item.operation];
                    return (
                      <label
                        key={item.operation}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            updateCollectionOperation(
                              collection.name,
                              item.operation,
                              checked === true,
                            )
                          }
                          aria-label={`${item.label} ${collection.label}`}
                        />
                        <span>{enabled ? "On" : "Off"}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  Collection overrides
                </div>
                <div className="text-xs text-muted-foreground">
                  Add an override only when one collection needs different write
                  access.
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
                <Select
                  value={newOverrideCollection}
                  onValueChange={setNewOverrideCollection}
                  disabled={availableOverrideCollections.length === 0}
                >
                  <SelectTrigger className="h-9 min-w-56">
                    <SelectValue
                      placeholder={
                        availableOverrideCollections.length === 0
                          ? "All collections overridden"
                          : "Add collection override"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOverrideCollections.map((collection) => (
                      <SelectItem key={collection.name} value={collection.name}>
                        {collection.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newOverrideCollection}
                  onClick={addCollectionOverride}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add override
                </Button>
                {overrideCount > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOverrides({})}
                  >
                    Clear overrides
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {activeOverrideCollections.length > 0 ? (
            <div className="border-y border-border">
              <div className="grid grid-cols-[minmax(180px,1fr)_120px_120px_120px_44px] bg-muted/50 px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">
                <div>Collection</div>
                {CMS_WRITE_PERMISSION_OPERATIONS.map((item) => (
                  <div key={item.operation}>{item.label}</div>
                ))}
                <div />
              </div>
              {activeOverrideCollections.map((collection) => (
                <div
                  key={collection.name}
                  className="grid grid-cols-[minmax(180px,1fr)_120px_120px_120px_44px] items-center border-t border-border px-4 py-3"
                >
                  <div className="min-w-0 pr-4">
                    <div className="truncate text-sm font-medium text-foreground">
                      {collection.label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {collection.name}
                    </div>
                  </div>
                  {CMS_WRITE_PERMISSION_OPERATIONS.map((item) => (
                    <Select
                      key={item.operation}
                      value={
                        collectionPresets[
                          permissionPresetKey(collection.name, item.operation)
                        ] ?? globalPresets[item.operation]
                      }
                      onValueChange={(value) =>
                        updateCollectionPreset(
                          collection.name,
                          item.operation,
                          value as CmsWriteRolePreset,
                        )
                      }
                    >
                      <SelectTrigger className="h-9 rounded-none border-0 bg-transparent px-2 shadow-none focus:ring-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admins</SelectItem>
                        <SelectItem value="editor">Editors</SelectItem>
                      </SelectContent>
                    </Select>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCollectionOverride(collection.name)}
                    aria-label={`Remove ${collection.label} override`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-y border-border px-4 py-8 text-sm text-muted-foreground">
              No collection overrides. All collections use the default policy.
            </div>
          )}
        </div>

        {error ? (
          <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Admins always keep access to prevent lockout.
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={submit}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save permissions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildGlobalPermissionPresets(
  permissions: CmsPermissionsConfig,
): Record<CmsPermissionOperation, CmsWriteRolePreset> {
  return {
    create: presetForRoles(permissions.content?.create),
    update: presetForRoles(permissions.content?.update),
    delete: presetForRoles(permissions.content?.delete),
  };
}

function buildOverrideState(
  collections: CmsCollectionConfig[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const collection of collections) {
    if (hasWritePermissionOverride(collection.permissions)) {
      result[collection.name] = true;
    }
  }
  return result;
}

function buildCollectionPermissionPresets(
  collections: CmsCollectionConfig[],
): Record<string, CmsWriteRolePreset> {
  const result: Record<string, CmsWriteRolePreset> = {};
  for (const collection of collections) {
    for (const { operation } of CMS_WRITE_PERMISSION_OPERATIONS) {
      const roles = collection.permissions?.content?.[operation];
      if (roles) {
        result[permissionPresetKey(collection.name, operation)] =
          presetForRoles(roles);
      }
    }
  }
  return result;
}

function buildCollectionOperationFlags(
  collections: CmsCollectionConfig[],
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const collection of collections) {
    for (const { operation } of CMS_WRITE_PERMISSION_OPERATIONS) {
      result[permissionPresetKey(collection.name, operation)] =
        collection.operations[operation];
    }
  }
  return result;
}

function hasWritePermissionOverride(
  permissions: CmsPermissionsConfig | undefined,
): boolean {
  return Boolean(
    permissions?.content?.create ||
    permissions?.content?.update ||
    permissions?.content?.delete,
  );
}

function clearWritePermissionOverrides(
  permissions: CmsPermissionsConfig | undefined,
): CmsPermissionsConfig {
  const nextContent = { ...(permissions?.content ?? {}) };
  delete nextContent.create;
  delete nextContent.update;
  delete nextContent.delete;

  const next: CmsPermissionsConfig = { ...(permissions ?? {}) };
  if (Object.keys(nextContent).length > 0) {
    next.content = nextContent;
  } else {
    delete next.content;
  }
  return next;
}

function permissionPresetKey(
  collection: string,
  operation: CmsPermissionOperation,
): string {
  return `${collection}:${operation}`;
}

function presetForRoles(roles: CmsRole[] | undefined): CmsWriteRolePreset {
  return roles?.includes("editor") ? "editor" : "admin";
}

function rolesForWritePreset(preset: CmsWriteRolePreset): CmsRole[] {
  return preset === "editor" ? ["editor", "admin"] : ["admin"];
}

function CollectionRail({
  loading,
  collections,
  selectedName,
  search,
  onSearchChange,
  onSelect,
}: {
  loading: boolean;
  collections: CmsCollectionConfig[];
  selectedName: string;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (name: string) => void;
}) {
  const trimmedSearch = search.trim().toLowerCase();
  const visibleCollections = useMemo(() => {
    if (!trimmedSearch) return collections;
    return collections.filter((collection) => {
      const label = collection.label.toLowerCase();
      const name = collection.name.toLowerCase();
      return label.includes(trimmedSearch) || name.includes(trimmedSearch);
    });
  }, [collections, trimmedSearch]);

  return (
    <aside
      aria-label="CMS collections"
      className="flex min-h-0 flex-col border-border"
    >
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Collections
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          {collections.length} configured
          {trimmedSearch ? ` / ${visibleCollections.length} shown` : ""}
        </div>
        <div className="relative mt-2 h-8">
          <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            aria-label="Filter collections"
            value={search}
            disabled={loading || collections.length === 0}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter"
            className="h-8 rounded-md border-input bg-background px-2 pl-7 text-xs shadow-sm focus-visible:ring-1"
          />
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
        ) : visibleCollections.length === 0 ? (
          <EmptyState
            title="No matches"
            detail="Try a different collection name."
          />
        ) : (
          <div className="space-y-1">
            {visibleCollections.map((collection) => {
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
  generateSchemaError,
  schemaSupported,
  adapterLabel,
  generatingSchema,
  onGenerateSchema,
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
  generateSchemaError: string | null;
  schemaSupported: boolean;
  adapterLabel: string;
  generatingSchema: boolean;
  onGenerateSchema: () => void;
  onPageChange: (offset: number) => void;
}) {
  if (!collection) {
    return (
      <GenerateSchemaState
        error={generateSchemaError}
        schemaSupported={schemaSupported}
        adapterLabel={adapterLabel}
        loading={generatingSchema}
        onSubmit={onGenerateSchema}
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

          <div className="flex items-center gap-2">
            {filtersActive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onFilterChange({})}
              >
                <X className="mr-2 h-4 w-4" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <DocumentTable
          collection={collection}
          documents={documents}
          loading={loading}
          filterValues={filterValues}
          sort={sort}
          onFilterChange={onFilterChange}
          onSortChange={onSortChange}
          onOpen={onOpenDocument}
        />
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

function GenerateSchemaState({
  error,
  schemaSupported,
  adapterLabel,
  loading,
  onSubmit,
}: {
  error: string | null;
  schemaSupported: boolean;
  adapterLabel: string;
  loading: boolean;
  onSubmit: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-6 md:px-8">
      <div className="w-full max-w-md text-center">
        <div className="text-sm font-medium text-foreground">
          No collections
        </div>
        {schemaSupported ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Generate a schema from MongoDB using the `DATABASE_URL` secret.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Kody will write the generated CMS config into the state repo.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {adapterLabel} collections are configured in CMS state.
          </p>
        )}

        {error ? (
          <div className="mt-4 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {schemaSupported ? (
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button type="button" onClick={onSubmit} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Database className="mr-2 h-4 w-4" />
              )}
              Generate schema
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CrudActions({
  collection,
  compact,
  editing,
  loading,
  actorRole,
  permissions,
  onEdit,
  onCancelEdit,
  onDelete,
}: {
  collection: CmsCollectionConfig;
  compact: boolean;
  editing?: boolean;
  loading?: boolean;
  actorRole: CmsRole;
  permissions?: CmsPermissionsConfig;
  onEdit?: () => void;
  onCancelEdit?: () => void;
  onDelete?: () => void;
}) {
  const updateDisabledReason = writeDisabledReason(
    collection,
    "update",
    actorRole,
    permissions,
  );
  const deleteDisabledReason = writeDisabledReason(
    collection,
    "delete",
    actorRole,
    permissions,
  );
  const canUpdate = canWriteOperation(
    collection,
    "update",
    actorRole,
    permissions,
  );
  const canDelete = canWriteOperation(
    collection,
    "delete",
    actorRole,
    permissions,
  );

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size={compact ? "icon" : "sm"}
        disabled={loading || (!editing && !canUpdate)}
        title={canUpdate ? "Edit" : updateDisabledReason}
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
      <Button
        type="button"
        size={compact ? "icon" : "sm"}
        disabled={loading || !canDelete}
        title={canDelete ? "Delete" : deleteDisabledReason}
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

function _CollectionFilters({
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
    return null;
  }

  return (
    <div className="border-t border-border bg-muted/20 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
          className="h-8 shrink-0 px-2.5 text-xs"
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
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
    <div className="flex h-8 w-full max-w-full items-stretch overflow-visible rounded-md border border-border bg-background shadow-sm sm:w-auto sm:min-w-[15.5rem]">
      <div className="flex max-w-[5.5rem] shrink-0 items-center border-r border-border bg-muted/50 px-2">
        <span
          className="truncate text-xs font-medium text-foreground"
          title={label}
        >
          {label}
        </span>
      </div>
      <Select value={operator} onValueChange={updateOperator}>
        <SelectTrigger className="h-8 w-24 shrink-0 rounded-none border-0 border-r border-border bg-transparent px-2 text-xs shadow-none focus:ring-0 focus:ring-offset-0">
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
      <div className="min-w-[5.75rem] flex-1">
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
        <SelectTrigger className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:ring-0 focus:ring-offset-0">
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
        <SelectTrigger className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:ring-0 focus:ring-offset-0">
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
        <SelectTrigger className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:ring-0 focus:ring-offset-0">
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
    <div className="relative h-8">
      {operator === "contains" ? (
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
      ) : null}
      <Input
        type={filterInputType(field, operator)}
        value={valueString}
        onChange={(event) => onChange(event.target.value)}
        placeholder={operator === "in" ? "Comma values" : "Filter"}
        className={cn(
          "h-8 rounded-md border-input bg-background px-2 text-xs shadow-sm focus-visible:ring-1",
          operator === "contains" ? "pl-7" : "",
        )}
      />
    </div>
  );
}

function buildRelationBatches(
  collections: CmsCollectionConfig[],
  documents: CmsDocument[],
  fields: ResolvedViewField[],
): CmsRelationBatch[] {
  const batches = new Map<string, CmsRelationBatch>();

  for (const { field } of fields) {
    if (!isRelationField(field) || !field.target) continue;
    const targetCollection = collections.find(
      (collection) => collection.name === field.target,
    );
    if (!targetCollection) continue;

    let batch = batches.get(targetCollection.name);
    if (!batch) {
      batch = { collection: targetCollection, ids: [] };
      batches.set(targetCollection.name, batch);
    }

    const seen = new Set(batch.ids);
    for (const document of documents) {
      const rawValue = document[field.name];
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        const id = relationId(value, field);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        batch.ids.push(id);
      }
    }
  }

  return [...batches.values()]
    .filter((batch) => batch.ids.length > 0)
    .map((batch) => ({
      ...batch,
      ids: batch.ids.slice(0, 100),
    }));
}

function DocumentTable({
  collection,
  documents,
  loading,
  filterValues,
  sort,
  onFilterChange,
  onSortChange,
  onOpen,
}: {
  collection: CmsCollectionConfig;
  documents: CmsDocument[];
  loading: boolean;
  filterValues: FilterValues;
  sort: CmsSortEntry[];
  onFilterChange: (next: FilterValues) => void;
  onSortChange: (next: CmsSortEntry[]) => void;
  onOpen: (id: string) => void;
}) {
  const relationContext = useContext(CmsRelationContext);
  const fields = useMemo(() => listViewFields(collection), [collection]);
  const filtersByField = useMemo(
    () => new Map(collection.filters.map((filter) => [filter.field, filter])),
    [collection.filters],
  );
  const idField = collection.source.idField ?? "_id";
  const relationBatches = useMemo(
    () =>
      buildRelationBatches(
        relationContext?.collections ?? [],
        documents,
        fields,
      ),
    [documents, fields, relationContext?.collections],
  );
  const batchSignature = relationBatches
    .map((batch) => `${batch.collection.name}:${batch.ids.join(",")}`)
    .join("|");
  const batchedRelationKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const batch of relationBatches) {
      for (const id of batch.ids) {
        keys.add(relationDocumentCacheKey(batch.collection.name, id));
      }
    }
    return keys;
  }, [relationBatches]);
  const relationDocumentsQuery = useQuery({
    queryKey: [
      "cms-relation-batch",
      relationContext?.scope ?? "",
      batchSignature,
    ],
    queryFn: async () => {
      const relationDocuments = new Map<string, CmsDocument>();
      await Promise.all(
        relationBatches.map(async (batch) => {
          const result = await fetchCmsDocumentsByIds(
            relationContext?.headers ?? {},
            batch.collection.name,
            batch.ids,
          );
          const targetIdField = batch.collection.source.idField ?? "_id";
          for (const document of result.docs) {
            const id = getDocumentId(document, targetIdField);
            if (id) {
              relationDocuments.set(
                relationDocumentCacheKey(batch.collection.name, id),
                document,
              );
            }
          }
        }),
      );
      return relationDocuments;
    },
    enabled: Boolean(relationContext && relationBatches.length > 0),
    staleTime: 60_000,
  });
  const scopedRelationContext = useMemo<CmsRelationContextValue | null>(() => {
    if (!relationContext) return null;
    return {
      ...relationContext,
      relationDocuments: relationDocumentsQuery.data,
      batchedRelationKeys,
    };
  }, [batchedRelationKeys, relationContext, relationDocumentsQuery.data]);
  const updateFilter = (
    filter: CmsFilterConfig,
    field: CmsFieldConfig,
    value: string | string[],
  ) => {
    const next = { ...filterValues };
    if (isBlankFilterValue(value)) {
      delete next[filter.field];
    } else {
      next[filter.field] = {
        operator: preferredFilterOperator(field, filter),
        value,
      };
    }
    onFilterChange(next);
  };

  return (
    <CmsRelationContext.Provider value={scopedRelationContext}>
      <div className="w-full min-w-0">
        <div
          className="sticky top-0 z-10 grid border-b border-border bg-background text-muted-foreground"
          style={{ gridTemplateColumns: tableGrid(fields) }}
        >
          {fields.map(({ field, view }, index) => {
            const sortDirection = sort.find(
              (entry) => entry.field === field.name,
            )?.direction;
            const sortable = isSortableViewField(field, view);
            const filter = filtersByField.get(field.name);
            const operator = filter
              ? preferredFilterOperator(field, filter)
              : null;
            const value =
              filter && operator
                ? (filterValues[filter.field]?.value ??
                  defaultFilterValue(filter, field).value)
                : "";
            const label = view?.label ?? field.label ?? field.name;
            return (
              <div
                key={field.name}
                className={cn(index === 0 ? "px-4" : "px-3", "py-2")}
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide">
                    {label}
                  </span>
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(nextSort(sort, field.name))}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={`Sort by ${label}`}
                    >
                      <span className="sr-only">Sort by {label}</span>
                      {sortDirection === "asc" ? (
                        <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                      ) : sortDirection === "desc" ? (
                        <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  ) : null}
                </div>
                {filter && operator ? (
                  <div className="mt-1">
                    <FilterValueControl
                      field={field}
                      operator={operator}
                      value={value}
                      onChange={(nextValue) =>
                        updateFilter(filter, field, nextValue)
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {loading ? (
          <LoadingRows />
        ) : documents.length === 0 ? (
          <EmptyState title="No items" detail="Try a different filter." />
        ) : (
          documents.map((document) => {
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
          })
        )}
      </div>
    </CmsRelationContext.Provider>
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
  editBlockedReason,
  saving,
  onSubmit,
  onCancelEdit,
}: {
  collection: CmsCollectionConfig;
  document: CmsDocument;
  editing: boolean;
  editBlockedReason: string | null;
  saving: boolean;
  onSubmit: (payload: CmsDocument) => void;
  onCancelEdit: () => void;
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

        <TabsContent value="fields" className="mt-0 min-h-0 flex-1">
          {editBlockedReason ? (
            <EmptyState title="Edit unavailable" detail={editBlockedReason} />
          ) : editing ? (
            <ContentFormPage
              collection={collection}
              document={document}
              saving={saving}
              onSubmit={onSubmit}
              onCancel={onCancelEdit}
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

        <TabsContent value="json" className="mt-0 min-h-0 flex-1">
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
  onCancel,
}: {
  collection: CmsCollectionConfig;
  document?: CmsDocument;
  saving: boolean;
  onSubmit: (payload: CmsDocument) => void;
  onCancel?: () => void;
}) {
  const fields = useMemo(() => formViewFields(collection), [collection]);
  const isEdit = Boolean(document);
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
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {fields.length === 0 ? (
            <EmptyState
              title="No editable fields"
              detail="This collection has no writable fields in the form view."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {fields.map(({ field, view }) => (
                <FormFieldControl
                  key={field.name}
                  field={field}
                  view={view}
                  value={values[field.name] ?? ""}
                  onChange={(value) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: value,
                    }))
                  }
                />
              ))}
            </div>
          )}

          {error ? (
            <div className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={saving || fields.length === 0}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </div>
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
  const description = field.description ?? field.display?.description;
  const placeholder = field.placeholder ?? field.display?.placeholder;
  const options = field.options?.map(normalizeOption) ?? [];
  const wide =
    field.display?.width === "fill" ||
    ["textarea", "json", "object", "array"].includes(field.type);

  if (field.type === "boolean") {
    return (
      <label className="space-y-1">
        <FormFieldLabel label={label} description={description} />
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
        <FormFieldLabel label={label} description={description} />
        <Select value={String(value)} onValueChange={(next) => onChange(next)}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={placeholder} />
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
        <FormFieldLabel label={label} description={description} />
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
          field.type === "relationMany" || wide ? "lg:col-span-2" : "",
        )}
      >
        <FormFieldLabel label={label} description={description} />
        <RelationPicker field={field} value={value} onChange={onChange} />
      </div>
    );
  }

  if (["textarea", "json", "object", "array"].includes(field.type)) {
    return (
      <label className="space-y-1 lg:col-span-2">
        <FormFieldLabel label={label} description={description} />
        <Textarea
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-h-28"
        />
      </label>
    );
  }

  return (
    <label className={cn("space-y-1", wide ? "lg:col-span-2" : "")}>
      <FormFieldLabel label={label} description={description} />
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
        placeholder={placeholder}
        className="h-9"
      />
    </label>
  );
}

function FormFieldLabel({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <span className="block space-y-1">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {description ? (
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      ) : null}
    </span>
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
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
  const selectedDocsQuery = useQuery({
    queryKey: [
      "cms-relation-selected",
      relationContext?.scope ?? "",
      targetCollection?.name ?? null,
      field.name,
      selectedIds.join("\0"),
    ],
    queryFn: () =>
      fetchCmsDocuments(
        relationContext?.headers ?? {},
        targetCollection?.name ?? "",
        {},
        undefined,
        [],
        Math.max(selectedIds.length, 1),
        0,
        selectedIds,
      ),
    enabled: Boolean(relationContext && targetCollection && selectedIds.length),
  });
  const selectedDocs = useMemo(
    () => selectedDocsQuery.data?.docs ?? [],
    [selectedDocsQuery.data?.docs],
  );
  const selectedDocById = useMemo(
    () =>
      targetCollection
        ? relationDocumentsById(targetCollection, field, selectedDocs)
        : new Map<string, CmsDocument>(),
    [field, selectedDocs, targetCollection],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (!targetCollection) {
    return (
      <Input
        value={multiple ? selectedIds.join(", ") : (selectedIds[0] ?? "")}
        onChange={(event) =>
          onChange(
            multiple ? splitListValue(event.target.value) : event.target.value,
          )
        }
        className={cn(
          "h-9",
          compact &&
            "h-8 rounded-md border-input bg-background px-2 text-xs shadow-sm focus-visible:ring-1",
        )}
      />
    );
  }

  const optionDocs = mergeRelationOptions(
    targetCollection,
    field,
    selectedDocs,
    filterRelationOptions(
      targetCollection,
      field,
      relationOptionsQuery.data?.docs ?? [],
      query,
      relationSearch,
    ),
  );
  const selectedSet = new Set(selectedIds);

  const selectId = (id: string) => {
    if (multiple) {
      onChange(
        selectedSet.has(id)
          ? selectedIds.filter((item) => item !== id)
          : [...selectedIds, id],
      );
      setQuery("");
      setOpen(true);
      return;
    }
    onChange(id);
    setQuery("");
    setOpen(false);
  };

  const clearId = (id: string) => {
    if (multiple) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange("");
  };

  const showOptions = Boolean(open && targetCollection);

  if (compact) {
    const selectedLabels = selectedIds.map((id) =>
      selectedRelationLabel(targetCollection, field, id, selectedDocById),
    );
    const compactLabel =
      selectedLabels.length === 0
        ? "Any"
        : multiple && selectedLabels.length > 1
          ? `${selectedLabels[0]} +${selectedLabels.length - 1}`
          : selectedLabels[0];

    return (
      <div
        ref={rootRef}
        className="relative h-8 min-w-0 rounded-md border border-input bg-background shadow-sm"
      >
        <div className="flex h-8 min-w-0 items-center">
          <button
            type="button"
            role="combobox"
            aria-expanded={showOptions}
            aria-controls={`${field.name}-relation-options`}
            onClick={() => setOpen((next) => !next)}
            className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 bg-transparent px-2 text-left text-xs outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
            title={selectedLabels.join(", ") || "Any"}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                selectedIds.length === 0 && "text-muted-foreground",
              )}
            >
              {compactLabel}
            </span>
            {selectedIds.length === 0 ? (
              <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : null}
          </button>
          {selectedIds.length > 0 ? (
            <button
              type="button"
              aria-label="Clear relation filter"
              onClick={(event) => {
                event.stopPropagation();
                onChange(multiple ? [] : "");
                setQuery("");
              }}
              className="flex h-8 w-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {showOptions ? (
          <div className="absolute left-0 top-[calc(100%+4px)] z-[60] w-[20rem] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-elevation-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder={`Search ${targetCollection.label}`}
                className="h-8 pl-7 text-xs"
              />
            </div>

            {multiple && selectedIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => clearId(id)}
                    className="flex max-w-full items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-left text-[11px] text-primary hover:bg-primary/15"
                    title="Remove"
                  >
                    <span className="truncate">
                      {selectedRelationLabel(
                        targetCollection,
                        field,
                        id,
                        selectedDocById,
                      )}
                    </span>
                    <X className="h-3 w-3 shrink-0" />
                  </button>
                ))}
              </div>
            ) : null}

            <div
              id={`${field.name}-relation-options`}
              role="listbox"
              className="mt-2 max-h-56 overflow-auto"
            >
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
                  const id = relationOptionId(
                    targetCollection,
                    field,
                    document,
                  );
                  if (!id) return null;
                  const selected = selectedSet.has(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => selectId(id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted",
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
                      {selected ? (
                        <Check className="h-3.5 w-3.5 shrink-0" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative rounded border border-border bg-card",
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
                <span className="block truncate">
                  {selectedRelationLabel(
                    targetCollection,
                    field,
                    id,
                    selectedDocById,
                  )}
                </span>
                <span className="block truncate font-mono text-[10px] text-primary/70">
                  {id}
                </span>
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
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={`Search ${targetCollection.label}`}
          role="combobox"
          aria-expanded={showOptions}
          aria-controls={`${field.name}-relation-options`}
          className="h-9 pl-8"
        />
      </div>

      {showOptions ? (
        <div
          id={`${field.name}-relation-options`}
          role="listbox"
          className="absolute left-3 right-3 top-full z-[60] mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-elevation-3"
        >
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
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectId(id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted",
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
      ) : null}
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

    const parsed = parseFormValue(field, value);
    assertCmsFieldValue(field, parsed);
    payload[field.name] = parsed;
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
  const cacheKey =
    targetCollection && id
      ? relationDocumentCacheKey(targetCollection.name, id)
      : null;
  const batchedDocument = cacheKey
    ? relationContext?.relationDocuments?.get(cacheKey)
    : undefined;
  const isBatched = cacheKey
    ? relationContext?.batchedRelationKeys?.has(cacheKey)
    : false;

  const relationQuery = useQuery({
    queryKey: ["cms-relation", field.target, id],
    queryFn: async () => {
      const result = await fetchCmsDocumentsByIds(
        relationContext?.headers ?? {},
        targetCollection?.name ?? "",
        id ? [id] : [],
      );
      return result.docs[0] ?? null;
    },
    enabled: Boolean(
      relationContext &&
      targetCollection &&
      id &&
      !batchedDocument &&
      !isBatched,
    ),
    staleTime: 60_000,
  });
  const relationDocument = batchedDocument ?? relationQuery.data;

  const label =
    targetCollection && relationDocument
      ? relationLabel(targetCollection, field, relationDocument, id)
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
        {relationQuery.isLoading && !batchedDocument
          ? formatShortValue(value)
          : label}
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

function UnconfiguredCmsState({
  adapters,
  selectedAdapter,
  loading,
  onAdapterChange,
  onCreate,
}: {
  adapters: CmsAdapterCatalogItem[];
  selectedAdapter: string;
  loading: boolean;
  onAdapterChange: (adapter: string) => void;
  onCreate: () => void;
}) {
  const selected = findCmsAdapter(adapters, selectedAdapter);

  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-8 text-center">
      <div className="text-sm font-medium text-foreground">
        CMS is not configured
      </div>
      <div className="mt-1 max-w-md text-sm text-muted-foreground">
        Create cms/config.json in the state repo to enable this view.
      </div>
      <div className="mt-4 w-full max-w-xs text-left">
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Adapter
        </div>
        <Select
          value={selectedAdapter}
          onValueChange={onAdapterChange}
          disabled={loading || adapters.length === 0}
        >
          <SelectTrigger aria-label="CMS adapter">
            <SelectValue placeholder="Select adapter" />
          </SelectTrigger>
          <SelectContent>
            {adapters.map((adapter) => (
              <SelectItem key={adapter.name} value={adapter.name}>
                {adapter.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected?.description ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {selected.description}
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        className="mt-4"
        size="sm"
        onClick={onCreate}
        disabled={loading || !selectedAdapter}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Plus className="mr-2 h-4 w-4" />
        )}
        Create CMS config
      </Button>
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

function findCmsAdapter(
  adapters: CmsAdapterCatalogItem[],
  name: string,
): CmsAdapterCatalogItem | null {
  return adapters.find((adapter) => adapter.name === name) ?? null;
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

function buildGenerateSchemaPayload(
  repoName: string | undefined,
  options: { refresh?: boolean } = {},
): GenerateCmsSchemaPayload {
  return {
    adapter: "mongodb",
    name: `${repoName ?? "Repo"} CMS`,
    refresh: options.refresh,
  };
}

function defaultFilterValue(
  filter: CmsFilterConfig,
  field?: CmsFieldConfig,
): FilterValue {
  const operator = field
    ? preferredFilterOperator(field, filter)
    : enabledFilterOperators(filter)[0];
  return {
    operator,
    value: operator === "exists" ? "true" : "",
  };
}

function preferredFilterOperator(
  field: CmsFieldConfig,
  filter: CmsFilterConfig,
): CmsFilterOperator {
  const operators = enabledFilterOperators(filter);
  const preferred =
    field.type === "relationMany" || field.type === "multiSelect"
      ? "in"
      : field.type === "text" || field.type === "textarea"
        ? "contains"
        : "equals";
  if (operators.includes(preferred)) return preferred;
  if (operators.includes("equals")) return "equals";
  if (operators.includes("contains")) return "contains";
  if (operators.includes("in")) return "in";
  return operators[0];
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

function mergeRelationOptions(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  selectedDocs: CmsDocument[],
  optionDocs: CmsDocument[],
): CmsDocument[] {
  const seen = new Set<string>();
  const merged: CmsDocument[] = [];

  for (const document of [...selectedDocs, ...optionDocs]) {
    const id = relationOptionId(targetCollection, field, document);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(document);
  }

  return merged;
}

function relationDocumentsById(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  documents: CmsDocument[],
): Map<string, CmsDocument> {
  const result = new Map<string, CmsDocument>();
  for (const document of documents) {
    const id = relationOptionId(targetCollection, field, document);
    if (id) result.set(id, document);
  }
  return result;
}

function selectedRelationLabel(
  targetCollection: CmsCollectionConfig,
  field: CmsFieldConfig,
  id: string,
  documentsById: Map<string, CmsDocument>,
): string {
  const document = documentsById.get(id);
  return document ? relationLabel(targetCollection, field, document, id) : id;
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
