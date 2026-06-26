/**
 * @fileType component
 * @domain kody
 * @pattern workflows-manager
 * @ai-summary CRUD UI for workflow definitions: a name, shared instructions,
 *   and an ordered queue of capabilities.
 */
"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@dashboard/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@dashboard/ui/dialog";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Textarea } from "@dashboard/ui/textarea";
import { useCapabilities } from "../hooks/useCapabilities";
import {
  useCreateWorkflowDefinition,
  useDeleteWorkflowDefinition,
  useUpdateWorkflowDefinition,
  useWorkflowDefinitions,
} from "../hooks/useWorkflowDefinitions";
import type {
  CreateWorkflowDefinitionInput,
  WorkflowDefinitionRecord,
} from "../workflow-definitions";
import { cn } from "../utils";
import { selectionPath } from "../selection-routing";
import { ConfirmDialog } from "./ConfirmDialog";
import { EmptyState } from "./EmptyState";
import { MasterDetailShell } from "./MasterDetailShell";
import { SearchableMultiSelect } from "./SearchableSelect";

const BASE_PATH = "/workflows";

interface WorkflowsManagerProps {
  selectedId?: string;
}

interface WorkflowFormState {
  name: string;
  instructions: string;
  capabilities: string[];
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

function mergeCapabilityQueue(current: string[], selected: string[]): string[] {
  const selectedSet = new Set(selected);
  const kept = current.filter((slug) => selectedSet.has(slug));
  const known = new Set(kept);
  const added = selected.filter((slug) => !known.has(slug));
  return [...kept, ...added];
}

function formatDate(value?: string): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workflowMatches(workflow: WorkflowDefinitionRecord, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const text = [
    workflow.id,
    workflow.workflow.name,
    workflow.workflow.instructions,
    ...workflow.workflow.capabilities,
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(q);
}

function isStoreWorkflow(workflow: WorkflowDefinitionRecord | null): boolean {
  return workflow?.source === "store" || workflow?.readOnly === true;
}

export function WorkflowsManager({ selectedId }: WorkflowsManagerProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] =
    useState<WorkflowDefinitionRecord | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] =
    useState<WorkflowDefinitionRecord | null>(null);

  const {
    data: workflows = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useWorkflowDefinitions();
  const { data: capabilities = [], isLoading: capabilitiesLoading } =
    useCapabilities();
  const createWorkflow = useCreateWorkflowDefinition();
  const updateWorkflow = useUpdateWorkflowDefinition(editingWorkflow?.id ?? "");
  const deleteWorkflow = useDeleteWorkflowDefinition();

  const filtered = useMemo(
    () => workflows.filter((workflow) => workflowMatches(workflow, search)),
    [workflows, search],
  );
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? null,
    [selectedId, workflows],
  );
  const capabilityBySlug = useMemo(
    () =>
      new Map(capabilities.map((capability) => [capability.slug, capability])),
    [capabilities],
  );
  const capabilityOptions = useMemo(
    () =>
      capabilities.map((capability) => ({
        value: capability.slug,
        label: capability.slug,
        selectedLabel: capability.slug,
        description: capability.describe,
        searchText: `${capability.slug} ${capability.describe ?? ""}`,
      })),
    [capabilities],
  );

  useEffect(() => {
    if (isLoading) return;
    if (filtered.length === 0) {
      if (selectedId) router.replace(BASE_PATH);
      return;
    }
    if (
      !selectedId ||
      !filtered.some((workflow) => workflow.id === selectedId)
    ) {
      router.replace(selectionPath(BASE_PATH, filtered[0]!.id));
    }
  }, [filtered, isLoading, router, selectedId]);

  const selectWorkflow = (id: string | null, replace = false) => {
    const path = id ? selectionPath(BASE_PATH, id) : BASE_PATH;
    if (replace) router.replace(path);
    else router.push(path);
  };

  return (
    <>
      <MasterDetailShell
        title="Workflows"
        icon={Workflow}
        iconClassName="text-cyan-400"
        subtitle={`${workflows.length} ${
          workflows.length === 1 ? "workflow" : "workflows"
        }`}
        error={
          error ? `Failed to load workflows: ${(error as Error).message}` : null
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search workflows..."
        searchAriaLabel="Search workflows"
        accent="teal"
        hasSelection={!!selectedWorkflow}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
              aria-label="Refresh workflows"
            >
              <RefreshCw
                className={cn("h-4 w-4", isFetching && "animate-spin")}
              />
            </Button>
            <Button
              size="sm"
              className="w-9 px-0"
              onClick={() => setCreateOpen(true)}
              title="New workflow"
              aria-label="New workflow"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </>
        }
        detail={
          selectedWorkflow ? (
            <WorkflowDetail
              workflow={selectedWorkflow}
              capabilityBySlug={capabilityBySlug}
              onBack={() => selectWorkflow(null)}
              onEdit={() => setEditingWorkflow(selectedWorkflow)}
              onDelete={() => setDeletingWorkflow(selectedWorkflow)}
            />
          ) : (
            <EmptyState
              icon={<Workflow />}
              title="Select a workflow"
              hint="Pick one from the list to see its instructions and capability queue."
            />
          )
        }
      >
        {isLoading ? (
          <EmptyState icon={<Workflow />} title="Loading workflows..." />
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="No workflows yet"
            hint="Create a workflow from shared instructions and an ordered capability queue."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                New workflow
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Workflow />}
            title="No matching workflows"
            hint={`Nothing matched "${search}".`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((workflow) => (
              <li key={workflow.id}>
                <WorkflowRow
                  workflow={workflow}
                  isActive={selectedId === workflow.id}
                  onSelect={() => selectWorkflow(workflow.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </MasterDetailShell>

      <WorkflowDialog
        open={createOpen}
        title="New workflow"
        description="Create an ordered queue of capabilities with shared instructions."
        capabilityOptions={capabilityOptions}
        capabilitiesLoading={capabilitiesLoading}
        saving={createWorkflow.isPending}
        onOpenChange={setCreateOpen}
        onSubmit={async (payload) => {
          const created = await createWorkflow.mutateAsync(payload);
          setCreateOpen(false);
          selectWorkflow(created.id);
        }}
      />

      <WorkflowDialog
        open={!!editingWorkflow}
        title="Edit workflow"
        description="Update the instructions and capability queue."
        initial={editingWorkflow ?? undefined}
        capabilityOptions={capabilityOptions}
        capabilitiesLoading={capabilitiesLoading}
        saving={updateWorkflow.isPending}
        onOpenChange={(open) => {
          if (!open) setEditingWorkflow(null);
        }}
        onSubmit={async (payload) => {
          if (!editingWorkflow) return;
          await updateWorkflow.mutateAsync(payload);
          setEditingWorkflow(null);
        }}
      />

      <ConfirmDialog
        open={!!deletingWorkflow}
        title={
          isStoreWorkflow(deletingWorkflow)
            ? `Remove Store workflow ${deletingWorkflow?.id ?? ""}?`
            : `Delete workflow ${deletingWorkflow?.id ?? ""}?`
        }
        description={
          isStoreWorkflow(deletingWorkflow)
            ? "This repo will stop using the Store workflow. The Store workflow will not be deleted."
            : "The workflow definition file will be removed from the state repo."
        }
        confirmLabel={isStoreWorkflow(deletingWorkflow) ? "Remove" : "Delete"}
        variant="destructive"
        onClose={() => setDeletingWorkflow(null)}
        onConfirm={() => {
          if (!deletingWorkflow) return;
          deleteWorkflow.mutate(deletingWorkflow.id, {
            onSuccess: () => selectWorkflow(null, true),
          });
        }}
      />
    </>
  );
}

function WorkflowRow({
  workflow,
  isActive,
  onSelect,
}: {
  workflow: WorkflowDefinitionRecord;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "block w-full px-4 py-3 text-left transition-colors hover:bg-accent/50",
        isActive && "bg-cyan-500/10",
      )}
      onClick={onSelect}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="truncate text-sm font-medium text-foreground">
            {workflow.workflow.name}
          </div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {workflow.id}
          </div>
        </div>
        {isStoreWorkflow(workflow) ? <StoreWorkflowBadge /> : null}
        <span className="shrink-0 rounded border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-200">
          {workflow.workflow.capabilities.length}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
        {workflow.workflow.instructions}
      </p>
    </button>
  );
}

function WorkflowDetail({
  workflow,
  capabilityBySlug,
  onBack,
  onEdit,
  onDelete,
}: {
  workflow: WorkflowDefinitionRecord;
  capabilityBySlug: Map<string, { slug: string; describe?: string }>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const storeBacked = isStoreWorkflow(workflow);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-3 gap-1 md:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Workflow className="h-5 w-5 shrink-0 text-cyan-300" />
            <h2 className="truncate text-xl font-semibold text-foreground">
              {workflow.workflow.name}
            </h2>
            {storeBacked ? <StoreWorkflowBadge /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{workflow.id}</span>
            {workflow.htmlUrl ? (
              <>
                <span>·</span>
                <a
                  href={workflow.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  GitHub
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onEdit}
            disabled={storeBacked}
            title={
              storeBacked
                ? "Store workflows are read-only in this repo"
                : "Edit workflow"
            }
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            {storeBacked ? "Remove" : "Delete"}
          </Button>
        </div>
      </div>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <FileText className="h-4 w-4 text-cyan-300" />
          Instructions
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
          {workflow.workflow.instructions}
        </p>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Route className="h-4 w-4 text-cyan-300" />
            Capability Queue
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {workflow.workflow.capabilities.length}
          </span>
        </div>
        <div className="space-y-2">
          {workflow.workflow.capabilities.map((slug, index) => {
            const capability = capabilityBySlug.get(slug);
            return (
              <div
                key={`${slug}:${index}`}
                className="grid gap-3 rounded border border-border bg-background px-3 py-3 md:grid-cols-[auto_minmax(0,1fr)]"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 font-mono text-xs text-cyan-700 dark:text-cyan-200">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-foreground">
                    {slug}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {capability?.describe ??
                      "Capability not found in this repo."}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="text-xs text-muted-foreground">
        Updated {formatDate(workflow.workflow.updatedAt)}
      </div>
    </div>
  );
}

function StoreWorkflowBadge() {
  return (
    <span className="shrink-0 rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-200">
      Store
    </span>
  );
}

function WorkflowDialog({
  open,
  title,
  description,
  initial,
  capabilityOptions,
  capabilitiesLoading,
  saving,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  initial?: WorkflowDefinitionRecord;
  capabilityOptions: Array<{
    value: string;
    label: string;
    selectedLabel?: string;
    description?: string;
    searchText?: string;
  }>;
  capabilitiesLoading: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateWorkflowDefinitionInput) => Promise<void>;
}) {
  const [form, setForm] = useState<WorkflowFormState>({
    name: "",
    instructions: "",
    capabilities: [],
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: initial?.workflow.name ?? "",
      instructions: initial?.workflow.instructions ?? "",
      capabilities: initial?.workflow.capabilities ?? [],
    });
  }, [initial, open]);

  const canSave =
    form.name.trim().length > 0 &&
    form.instructions.trim().length > 0 &&
    form.capabilities.length > 0 &&
    !saving;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      toast.error(
        "Name, instructions, and at least one capability are required",
      );
      return;
    }
    await onSubmit({
      name: form.name.trim(),
      instructions: form.instructions.trim(),
      capabilities: form.capabilities,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] min-w-0 max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden sm:w-[42rem]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="min-w-0 max-w-full space-y-5 overflow-x-hidden"
          onSubmit={submit}
        >
          <div className="min-w-0 space-y-2">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Release readiness"
              autoFocus
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="workflow-instructions">Instructions</Label>
            <Textarea
              id="workflow-instructions"
              value={form.instructions}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  instructions: event.target.value,
                }))
              }
              placeholder="Tell the capabilities what this workflow should achieve."
              className="min-h-[140px]"
            />
          </div>

          <div className="min-w-0 space-y-2">
            <Label>Capabilities</Label>
            <SearchableMultiSelect
              value={form.capabilities}
              options={capabilityOptions}
              onChange={(selected) =>
                setForm((prev) => ({
                  ...prev,
                  capabilities: mergeCapabilityQueue(
                    prev.capabilities,
                    selected,
                  ),
                }))
              }
              placeholder={
                capabilitiesLoading
                  ? "Loading capabilities..."
                  : "Select capabilities"
              }
              searchPlaceholder="Search capabilities..."
              emptyLabel="No capabilities found"
              selectedLabel="capabilities"
              selectedSingularLabel="capability"
              showSelectedSummary={false}
              closeOnSelect
              disabled={capabilitiesLoading}
            />
          </div>

          <OrderedCapabilityQueue
            capabilities={form.capabilities}
            onMove={(index, direction) =>
              setForm((prev) => ({
                ...prev,
                capabilities: moveItem(prev.capabilities, index, direction),
              }))
            }
            onRemove={(index) =>
              setForm((prev) => ({
                ...prev,
                capabilities: prev.capabilities.filter((_, i) => i !== index),
              }))
            }
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OrderedCapabilityQueue({
  capabilities,
  onMove,
  onRemove,
}: {
  capabilities: string[];
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  if (capabilities.length === 0) return null;

  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/25 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground">Queue order</h3>
          <p className="text-xs text-muted-foreground">
            Capabilities run in this order.
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {capabilities.length}
        </span>
      </div>
      <div className="space-y-2">
        {capabilities.map((slug, index) => (
          <div
            key={`${slug}:${index}`}
            className="grid gap-3 rounded border border-border bg-background px-3 py-2 text-sm md:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="flex min-w-0 items-center gap-2 text-foreground">
              <Route className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
              <span className="font-mono text-xs text-muted-foreground">
                {index + 1}
              </span>
              <span className="truncate font-mono">{slug}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={() => onMove(index, -1)}
                disabled={index === 0}
                aria-label={`Move ${slug} up`}
                title="Move up"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                onClick={() => onMove(index, 1)}
                disabled={index === capabilities.length - 1}
                aria-label={`Move ${slug} down`}
                title="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0 text-destructive hover:text-destructive"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${slug}`}
                title="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
