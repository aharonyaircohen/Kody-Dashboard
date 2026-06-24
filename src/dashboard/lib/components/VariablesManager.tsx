/**
 * @fileType component
 * @domain variables
 * @pattern variables-manager
 * @ai-summary CRUD UI for the dashboard variables store. Per-repo plaintext
 *   JSON in the connected repo's external state repo. Unlike secrets, values are visible/editable
 *   in the UI — variables hold non-sensitive config (model lists, feature
 *   flags, etc) that the dashboard reads at runtime.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { PageShell } from "./PageShell";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
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
import { AuthGuard } from "../auth-guard";
import { useAuth, buildAuthHeaders } from "../auth-context";

interface VariableRow {
  name: string;
  value: string;
  updatedAt: string;
  updatedBy?: string;
}

const NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

export interface VariablesQueryScope {
  owner?: string | null;
  repo?: string | null;
}

function variablesQueryScopeFromAuth(
  auth: { owner?: string | null; repo?: string | null } | null | undefined,
): VariablesQueryScope {
  return {
    owner: auth?.owner ?? null,
    repo: auth?.repo ?? null,
  };
}

export const variablesQueryKeys = {
  all: ["kody-variables"] as const,
  list: (scope: VariablesQueryScope = {}) =>
    ["kody-variables", scope.owner ?? null, scope.repo ?? null] as const,
};

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return "just now";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

async function listVariables(
  headers: Record<string, string>,
): Promise<VariableRow[]> {
  const res = await fetch("/api/kody/variables", {
    headers,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    variables?: VariableRow[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.variables ?? [];
}

async function upsertVariable(
  headers: Record<string, string>,
  name: string,
  value: string,
  actorLogin?: string,
): Promise<void> {
  const res = await fetch("/api/kody/variables", {
    method: "POST",
    headers,
    body: JSON.stringify({ name, value, actorLogin }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

async function deleteVariable(
  headers: Record<string, string>,
  name: string,
): Promise<void> {
  const res = await fetch(`/api/kody/variables/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers,
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

export function VariablesManager() {
  return (
    <AuthGuard>
      <VariablesManagerInner />
    </AuthGuard>
  );
}

function VariablesManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;
  const queryScope = variablesQueryScopeFromAuth(auth);
  const listQueryKey = variablesQueryKeys.list(queryScope);

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<VariableRow[]>({
    queryKey: listQueryKey,
    queryFn: () => listVariables(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const variables = data ?? [];

  const upsert = useMutation({
    mutationFn: (input: { name: string; value: string }) =>
      upsertVariable(headers, input.name, input.value, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: variablesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Variable saved");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save variable"),
  });

  const remove = useMutation({
    mutationFn: (name: string) => deleteVariable(headers, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: variablesQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      toast.success("Variable deleted");
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete variable"),
  });

  const [editing, setEditing] = useState<{
    name: string;
    value: string;
    existing: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  return (
    <PageShell
      title="Variables"
      icon={Settings2}
      iconClassName="text-sky-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <Button
          size="sm"
          onClick={() => setEditing({ name: "", value: "", existing: false })}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New variable
        </Button>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading variables…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load variables
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && variables.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Settings2 className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No variables yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Variables are plaintext config stored as{" "}
                <code className="text-white/55">variables.json</code> in the
                state repo. Use them for non-sensitive values the dashboard
                reads at runtime — model lists, feature flags, default ids.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  setEditing({ name: "", value: "", existing: false })
                }
                className="gap-1"
              >
                <Plus className="w-4 h-4" />
                Add your first variable
              </Button>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {variables.map((v) => (
            <li key={v.name}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-white/90 truncate">
                      {v.name}
                    </p>
                    <p className="font-mono text-xs text-white/55 mt-1 break-all line-clamp-2">
                      {v.value}
                    </p>
                    <p className="text-[11px] text-white/40 mt-1">
                      Updated {formatRelative(v.updatedAt)}
                      {v.updatedBy ? ` by ${v.updatedBy}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() =>
                        setEditing({
                          name: v.name,
                          value: v.value,
                          existing: true,
                        })
                      }
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-rose-300 hover:text-rose-200"
                      onClick={() => setDeleting(v.name)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-white/30 pt-4">
          Stored in plaintext as{" "}
          <code className="text-white/50">variables.json</code> in the state
          repo. For sensitive values, use{" "}
          <Link
            href="/secrets"
            className="text-white/60 hover:text-white/80 underline"
          >
            /secrets
          </Link>{" "}
          instead.
        </p>
      </div>

      {editing && (
        <VariableEditor
          initialName={editing.name}
          initialValue={editing.value}
          isUpdate={editing.existing}
          onClose={() => setEditing(null)}
          onSave={(name, value) =>
            upsert.mutateAsync({ name, value }).then(() => setEditing(null))
          }
          saving={upsert.isPending}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting}?`}
        description="The variable is removed from variables.json in the state repo. Runtime code reading it falls back to environment variables."
        confirmLabel={remove.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting) remove.mutate(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface VariableEditorProps {
  initialName: string;
  initialValue: string;
  isUpdate: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string, value: string) => Promise<void>;
}

function VariableEditor({
  initialName,
  initialValue,
  isUpdate,
  saving,
  onClose,
  onSave,
}: VariableEditorProps) {
  const [name, setName] = useState(initialName);
  const [value, setValue] = useState(initialValue);
  const [touchedName, setTouchedName] = useState(false);

  const nameError = (() => {
    if (!touchedName && !isUpdate) return null;
    if (!name) return "Required";
    if (!NAME_RE.test(name))
      return "Use uppercase letters, digits, underscores. Start with a letter.";
    return null;
  })();

  const valueError = value.length === 0 ? "Required" : null;
  const canSave = !saving && !nameError && !valueError;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isUpdate ? `Edit ${initialName}` : "New variable"}
          </DialogTitle>
          <DialogDescription>
            Stored plaintext in <code>variables.json</code> in the state repo.
            Use this page for non-sensitive config only.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-white/[0.08] bg-white/[0.03] p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium text-white/70">Active file</span>
            <code className="font-mono text-sky-200">variables.json</code>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="font-medium text-white/70">Active variable</span>
            <code className="font-mono text-white/70">
              {isUpdate ? initialName : name || "New variable"}
            </code>
          </div>
          {isUpdate ? (
            <div className="mt-3 space-y-1.5">
              <p className="font-medium text-white/70">Current saved value</p>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border border-white/[0.06] bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-white/65">
                {initialValue}
              </pre>
            </div>
          ) : null}
        </div>
        <div className="space-y-3 mt-3">
          <div>
            <Label htmlFor="var-name" className="text-xs">
              Name
            </Label>
            <Input
              id="var-name"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onBlur={() => setTouchedName(true)}
              disabled={isUpdate}
              placeholder="LLM_MODELS"
              className="font-mono"
            />
            {nameError && (
              <p className="text-xs text-rose-300 mt-1">{nameError}</p>
            )}
          </div>
          <div>
            <Label htmlFor="var-value" className="text-xs">
              Value
            </Label>
            <Textarea
              id="var-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="any string — JSON, plain text, ids…"
              className="font-mono text-xs"
              rows={6}
              autoFocus={!isUpdate}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={() => {
              if (canSave) onSave(name, value);
            }}
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                Saving…
              </>
            ) : isUpdate ? (
              "Update"
            ) : (
              "Create"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
