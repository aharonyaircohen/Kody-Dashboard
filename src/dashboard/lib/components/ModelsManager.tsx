/**
 * @fileType component
 * @domain variables
 * @pattern models-manager
 * @ai-summary CRUD UI for the chat model list (LLM_MODELS variable).
 *   Scannable list view; the editor opens in a dialog with just the
 *   essentials surfaced — provider preset auto-fills baseURL/protocol,
 *   "Advanced" reveals internal id + URL + protocol for the `custom`
 *   provider case. The list drives the chat dropdown across the
 *   dashboard and /vibe; both fall back to Kody Live when empty.
 */
"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Cpu,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { PageShell } from "./PageShell";
import { PerExecutableModelCard } from "./PerExecutableModelCard";
import { Button } from "@dashboard/ui/button";
import { Card, CardContent } from "@dashboard/ui/card";
import { Input } from "@dashboard/ui/input";
import { Label } from "@dashboard/ui/label";
import { Checkbox } from "@dashboard/ui/checkbox";
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
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESET_IDS,
  type ChatModel,
  type ChatProtocol,
  type ProviderPreset,
} from "../variables/models";

const modelsQueryKey = ["kody-chat-models"] as const;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/;

async function fetchModels(
  headers: Record<string, string>,
): Promise<ChatModel[]> {
  const res = await fetch("/api/kody/models", { headers });
  const json = (await res.json().catch(() => ({}))) as {
    models?: ChatModel[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
  return json.models ?? [];
}

async function saveModels(
  headers: Record<string, string>,
  models: ChatModel[],
  actorLogin?: string,
): Promise<void> {
  const res = await fetch("/api/kody/models", {
    method: "PUT",
    headers,
    body: JSON.stringify({ models, actorLogin }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`);
  }
}

function blankModel(): ChatModel {
  const p = PROVIDER_PRESETS.anthropic;
  return {
    id: "",
    label: "",
    provider: "anthropic",
    protocol: p.protocol,
    baseURL: p.baseURL,
    modelName: "",
    apiKeySecret: p.keyHint,
    enabled: true,
    default: false,
    engineDefault: false,
  };
}

/** Derive an internal id when the user didn't override it. */
function deriveId(m: ChatModel): string {
  if (m.id.trim()) return m.id.trim();
  if (!m.modelName.trim()) return "";
  return `${m.provider}/${m.modelName.trim()}`;
}

export function ModelsManager() {
  return (
    <AuthGuard>
      <ModelsManagerInner />
    </AuthGuard>
  );
}

function ModelsManagerInner() {
  const { auth } = useAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  };
  const actorLogin = auth?.user.login;

  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ChatModel[]>({
    queryKey: modelsQueryKey,
    queryFn: () => fetchModels(headers),
    enabled: !!auth,
    staleTime: 30_000,
  });
  const models = data ?? [];

  const save = useMutation({
    mutationFn: (list: ChatModel[]) => saveModels(headers, list, actorLogin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: modelsQueryKey });
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save models"),
  });

  const [editing, setEditing] = useState<
    { mode: "create" } | { mode: "edit"; idx: number } | null
  >(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const upsert = (next: ChatModel) => {
    let list = [...models];
    if (editing?.mode === "edit") {
      list[editing.idx] = next;
    } else {
      list.push(next);
    }
    // Enforce "at most one default" client-side by clearing the flag on
    // every other entry when this one sets it. Without this the server
    // rejects the save. Chat default and engine default are independent
    // flags, so clear each one separately.
    const savedIdx = editing?.mode === "edit" ? editing.idx : list.length - 1;
    if (next.default) {
      list = list.map((m, i) =>
        i === savedIdx ? m : { ...m, default: false },
      );
    }
    if (next.engineDefault) {
      list = list.map((m, i) =>
        i === savedIdx ? m : { ...m, engineDefault: false },
      );
    }
    return save.mutateAsync(list).then(() => {
      toast.success("Model saved");
      setEditing(null);
    });
  };

  const toggleEnabled = (idx: number) => {
    const list = models.map((m, i) =>
      i === idx ? { ...m, enabled: m.enabled === false } : m,
    );
    save.mutate(list);
  };

  const remove = (idx: number) => {
    const list = models.filter((_, i) => i !== idx);
    save.mutateAsync(list).then(() => {
      toast.success("Model deleted");
      setDeleting(null);
    });
  };

  return (
    <PageShell
      title="Chat Models"
      icon={Bot}
      iconClassName="text-violet-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <Button
          size="sm"
          onClick={() => setEditing({ mode: "create" })}
          className="gap-1"
        >
          <Plus className="w-4 h-4" />
          New model
        </Button>
      }
    >
      <div className="space-y-3">
        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading models…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load models
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

        {!isLoading && !error && models.length === 0 && (
          <Card className="border-white/[0.08] bg-white/[0.02]">
            <CardContent className="p-6 text-center space-y-3">
              <Bot className="w-8 h-8 text-white/30 mx-auto" />
              <p className="text-sm text-white/70">No chat models yet.</p>
              <p className="text-xs text-white/40 max-w-md mx-auto">
                Until you add one, the chat dropdown shows only{" "}
                <strong className="text-white/60">Kody Live</strong> (GitHub
                Actions engine). Each model uses its own API key stored under{" "}
                <Link
                  href="/secrets"
                  className="text-white/60 hover:text-white/80 underline"
                >
                  /secrets
                </Link>
                .
              </p>
              <Button
                size="sm"
                onClick={() => setEditing({ mode: "create" })}
                className="gap-1"
              >
                <Plus className="w-4 h-4" />
                Add your first model
              </Button>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {models.map((m, idx) => (
            <li key={idx}>
              <Card className="border-white/[0.08] bg-white/[0.03]">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1 flex items-center gap-3">
                    <Checkbox
                      checked={m.enabled !== false}
                      onCheckedChange={() => toggleEnabled(idx)}
                      aria-label={m.enabled === false ? "Enable" : "Disable"}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white/90 truncate">
                          {m.label || m.modelName || m.id}
                        </span>
                        {m.default && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300"
                            title="Auto-selected when chat opens"
                          >
                            <Star className="w-3 h-3" />
                            Chat
                          </span>
                        )}
                        {m.engineDefault && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300"
                            title="The model the engine runs (Kody Live, issue + PR runs)"
                          >
                            <Cpu className="w-3 h-3" />
                            Engine
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/45 mt-0.5 font-mono truncate">
                        {PROVIDER_PRESETS[m.provider]?.label ?? m.provider} ·{" "}
                        {m.modelName}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1"
                      onClick={() => setEditing({ mode: "edit", idx })}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-rose-300 hover:text-rose-200"
                      onClick={() => setDeleting(idx)}
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
          Each model uses its own API key under{" "}
          <Link
            href="/secrets"
            className="text-white/60 hover:text-white/80 underline"
          >
            /secrets
          </Link>
          . With no models or a missing key the chat falls back to{" "}
          <strong className="text-white/60">Kody Live</strong>.
        </p>

        {/* Per-executable model overrides (agent.perExecutable) */}
        {!isLoading && !error && <PerExecutableModelCard models={models} />}
      </div>

      {editing && (
        <ModelEditor
          initial={editing.mode === "edit" ? models[editing.idx] : blankModel()}
          existing={models}
          editingIdx={editing.mode === "edit" ? editing.idx : null}
          saving={save.isPending}
          onClose={() => setEditing(null)}
          onSave={upsert}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this model?"
        description="The model is removed from LLM_MODELS. The chat dropdown updates immediately; the underlying API key under /secrets is not touched."
        confirmLabel={save.isPending ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={() => {
          if (deleting !== null) remove(deleting);
        }}
        onClose={() => setDeleting(null)}
      />
    </PageShell>
  );
}

interface ModelEditorProps {
  initial: ChatModel;
  existing: ChatModel[];
  editingIdx: number | null;
  saving: boolean;
  onClose: () => void;
  onSave: (m: ChatModel) => Promise<void>;
}

function ModelEditor({
  initial,
  existing,
  editingIdx,
  saving,
  onClose,
  onSave,
}: ModelEditorProps) {
  const [draft, setDraft] = useState<ChatModel>(initial);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(
    initial.provider === "custom",
  );

  // When the user picks a different preset, refresh the auto-managed
  // fields. The user's modelName + label survive — only baseURL/protocol/
  // key-hint update so they can quickly try different providers.
  const applyPreset = (preset: ProviderPreset) => {
    const p = PROVIDER_PRESETS[preset];
    setDraft((cur) => ({
      ...cur,
      provider: preset,
      protocol: p.protocol,
      baseURL: p.baseURL,
      // Only overwrite the key hint when the user hasn't typed a custom
      // value yet (i.e. it matches the previous preset's hint). Avoids
      // clobbering a deliberate override.
      apiKeySecret:
        cur.apiKeySecret === PROVIDER_PRESETS[cur.provider].keyHint
          ? p.keyHint
          : cur.apiKeySecret,
    }));
    if (preset === "custom") setAdvancedOpen(true);
  };

  // Derived id — what we'll actually save when the user hasn't set one.
  const derivedId = deriveId(draft);
  const idClash =
    derivedId !== "" &&
    existing.some((m, i) => i !== editingIdx && deriveId(m) === derivedId);

  const errors = {
    label: draft.label.trim() ? null : "Required",
    modelName: draft.modelName.trim() ? null : "Required",
    apiKeySecret: !draft.apiKeySecret.trim()
      ? "Required"
      : !SECRET_NAME_RE.test(draft.apiKeySecret)
        ? "Uppercase letters, digits, _ — start with a letter"
        : null,
    baseURL:
      draft.protocol === "openai" && !draft.baseURL.trim()
        ? "Required for OpenAI-compatible models"
        : null,
    id: idClash ? "Another model already uses this id" : null,
  };
  const canSave =
    !saving &&
    !errors.label &&
    !errors.modelName &&
    !errors.apiKeySecret &&
    !errors.baseURL &&
    !errors.id;

  const handleSave = () => {
    if (!canSave) return;
    const finalModel: ChatModel = {
      ...draft,
      id: derivedId,
    };
    onSave(finalModel);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingIdx !== null ? "Edit model" : "Add model"}
          </DialogTitle>
          <DialogDescription>
            Pick a provider and fill in the model + key. Defaults cover the
            common cases — open Advanced to override URL or protocol.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs">Provider</Label>
            <select
              value={draft.provider}
              onChange={(ev) => applyPreset(ev.target.value as ProviderPreset)}
              className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-sm"
            >
              {PROVIDER_PRESET_IDS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_PRESETS[p].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label className="text-xs">Model name</Label>
            <Input
              value={draft.modelName}
              onChange={(ev) =>
                setDraft((cur) => ({
                  ...cur,
                  modelName: ev.target.value.trim(),
                }))
              }
              placeholder={
                draft.provider === "anthropic"
                  ? "claude-sonnet-4-6"
                  : draft.provider === "google"
                    ? "gemini-2.5-flash"
                    : draft.provider === "openai"
                      ? "gpt-4o"
                      : "model-id"
              }
              className="font-mono text-xs"
            />
            {errors.modelName && (
              <p className="text-[11px] text-rose-300 mt-1">
                {errors.modelName}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Display label</Label>
            <Input
              value={draft.label}
              onChange={(ev) =>
                setDraft((cur) => ({ ...cur, label: ev.target.value }))
              }
              placeholder="Claude Sonnet 4.6"
              className="text-xs"
              autoFocus={editingIdx === null}
            />
            {errors.label && (
              <p className="text-[11px] text-rose-300 mt-1">{errors.label}</p>
            )}
          </div>

          <div>
            <Label className="text-xs">API key secret</Label>
            <Input
              value={draft.apiKeySecret}
              onChange={(ev) =>
                setDraft((cur) => ({
                  ...cur,
                  apiKeySecret: ev.target.value.toUpperCase(),
                }))
              }
              placeholder="ANTHROPIC_API_KEY"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-white/40 mt-1">
              Set this value under{" "}
              <Link
                href="/secrets"
                className="text-white/60 hover:text-white/80 underline"
              >
                /secrets
              </Link>
              .
            </p>
            {errors.apiKeySecret && (
              <p className="text-[11px] text-rose-300 mt-1">
                {errors.apiKeySecret}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer pt-1">
            <Checkbox
              checked={draft.default === true}
              onCheckedChange={(checked) =>
                setDraft((cur) => ({ ...cur, default: checked === true }))
              }
            />
            <Star className="w-3.5 h-3.5 text-white/40" />
            Default for chat (auto-selected on open)
          </label>

          <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
            <Checkbox
              checked={draft.engineDefault === true}
              onCheckedChange={(checked) =>
                setDraft((cur) => ({ ...cur, engineDefault: checked === true }))
              }
            />
            <Cpu className="w-3.5 h-3.5 text-white/40" />
            Default for engine (Kody Live, issue + PR runs)
          </label>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-xs text-white/55 hover:text-white/80 flex items-center gap-1 pt-2"
          >
            {advancedOpen ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            Advanced
          </button>

          {advancedOpen && (
            <div className="space-y-3 pt-1 border-t border-white/[0.06]">
              <div>
                <Label className="text-xs">Base URL</Label>
                <Input
                  value={draft.baseURL}
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      baseURL: ev.target.value.trim(),
                    }))
                  }
                  placeholder="https://api.example.com/v1"
                  className="font-mono text-xs"
                />
                {errors.baseURL && (
                  <p className="text-[11px] text-rose-300 mt-1">
                    {errors.baseURL}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">Protocol</Label>
                <select
                  value={draft.protocol}
                  onChange={(ev) =>
                    setDraft((cur) => ({
                      ...cur,
                      protocol: ev.target.value as ChatProtocol,
                    }))
                  }
                  className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-xs font-mono"
                >
                  <option value="anthropic">anthropic</option>
                  <option value="openai">openai</option>
                </select>
              </div>
              <div>
                <Label className="text-xs">Internal id (auto)</Label>
                <Input
                  value={draft.id || derivedId}
                  onChange={(ev) =>
                    setDraft((cur) => ({ ...cur, id: ev.target.value.trim() }))
                  }
                  placeholder={derivedId || "<provider>/<modelName>"}
                  className="font-mono text-xs"
                />
                {errors.id && (
                  <p className="text-[11px] text-rose-300 mt-1">{errors.id}</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Max research steps</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={draft.maxSteps ?? ""}
                  onChange={(ev) => {
                    const raw = ev.target.value.trim();
                    if (raw === "") {
                      setDraft((cur) => {
                        const { maxSteps: _, ...rest } = cur;
                        return rest as ChatModel;
                      });
                      return;
                    }
                    const n = Number.parseInt(raw, 10);
                    if (!Number.isFinite(n)) return;
                    setDraft((cur) => ({ ...cur, maxSteps: n }));
                  }}
                  placeholder="10 (default)"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Per-turn tool-call rounds. Blank → 10 (30 in goal-planner).
                  Raise for models that need long research chains.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!canSave}
            onClick={handleSave}
            className="gap-1"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                {editingIdx !== null ? "Save" : "Add"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
