/**
 * @fileType component
 * @domain variables
 * @pattern models-manager
 * @ai-summary CRUD UI for the chat model list (LLM_MODELS variable). Each
 *   row binds one model to its own API key, base URL, and wire protocol
 *   (Anthropic Messages or OpenAI Chat Completions). A provider preset
 *   dropdown pre-fills baseURL + protocol + key hint so common providers
 *   are one-click. The list drives the chat dropdown across the dashboard
 *   and /vibe; both surfaces fall back to Kody Live when the list is empty.
 */
"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Bot,
  Loader2,
  Mic,
  Plus,
  Save,
  Trash2,
} from "lucide-react"
import { PageShell } from "./PageShell"
import { Button } from "@dashboard/ui/button"
import { Card, CardContent } from "@dashboard/ui/card"
import { Input } from "@dashboard/ui/input"
import { Label } from "@dashboard/ui/label"
import { Checkbox } from "@dashboard/ui/checkbox"
import { AuthGuard } from "../auth-guard"
import { useAuth, buildAuthHeaders } from "../auth-context"
import {
  PROVIDER_PRESETS,
  PROVIDER_PRESET_IDS,
  type ChatModel,
  type ChatProtocol,
  type ProviderPreset,
} from "../variables/models"

const modelsQueryKey = ["kody-chat-models"] as const
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,127}$/

async function fetchModels(headers: Record<string, string>): Promise<ChatModel[]> {
  const res = await fetch("/api/kody/models", { headers })
  const json = (await res.json().catch(() => ({}))) as {
    models?: ChatModel[]
    error?: string
    message?: string
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
  return json.models ?? []
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
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
}

function blankModel(): ChatModel {
  return {
    id: "",
    label: "",
    provider: "anthropic",
    protocol: PROVIDER_PRESETS.anthropic.protocol,
    baseURL: PROVIDER_PRESETS.anthropic.baseURL,
    modelName: "",
    apiKeySecret: PROVIDER_PRESETS.anthropic.keyHint,
    enabled: true,
    speech: false,
  }
}

export function ModelsManager() {
  return (
    <AuthGuard>
      <ModelsManagerInner />
    </AuthGuard>
  )
}

function ModelsManagerInner() {
  const { auth } = useAuth()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  }
  const actorLogin = auth?.user.login

  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery<ChatModel[]>({
    queryKey: modelsQueryKey,
    queryFn: () => fetchModels(headers),
    enabled: !!auth,
    staleTime: 30_000,
  })

  // Draft buffer — lets the user edit several rows before committing.
  const [draft, setDraft] = useState<ChatModel[] | null>(null)
  useEffect(() => {
    if (data && draft === null) setDraft(data)
  }, [data, draft])

  const models = draft ?? data ?? []
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data ?? [])

  const save = useMutation({
    mutationFn: (list: ChatModel[]) => saveModels(headers, list, actorLogin),
    onSuccess: (_, list) => {
      queryClient.invalidateQueries({ queryKey: modelsQueryKey })
      setDraft(list)
      toast.success("Models saved")
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save models"),
  })

  // Validation: per-row errors + global constraints.
  const speechCount = models.filter((m) => m.speech).length
  const idCounts = new Map<string, number>()
  for (const m of models) idCounts.set(m.id, (idCounts.get(m.id) ?? 0) + 1)
  const duplicateIds = new Set(
    Array.from(idCounts.entries())
      .filter(([id, n]) => id && n > 1)
      .map(([id]) => id),
  )

  function rowErrors(m: ChatModel) {
    const errs: Partial<Record<keyof ChatModel, string>> = {}
    if (!m.id.trim()) errs.id = "Required"
    else if (duplicateIds.has(m.id)) errs.id = "Duplicate id"
    if (!m.label.trim()) errs.label = "Required"
    if (!m.modelName.trim()) errs.modelName = "Required"
    if (!m.apiKeySecret.trim()) errs.apiKeySecret = "Required"
    else if (!SECRET_NAME_RE.test(m.apiKeySecret))
      errs.apiKeySecret = "Uppercase letters, digits, _ — start with a letter"
    if (m.protocol === "openai" && !m.baseURL.trim())
      errs.baseURL = "Required for OpenAI-compatible models"
    return errs
  }
  const allErrors = models.map(rowErrors)
  const hasErrors =
    speechCount > 1 || allErrors.some((e) => Object.keys(e).length > 0)

  const updateRow = (idx: number, patch: Partial<ChatModel>) => {
    setDraft((cur) => {
      const base = cur ?? data ?? []
      const next = base.map((m, i) => (i === idx ? { ...m, ...patch } : m))
      // Enforce single speech flag: setting one clears all others.
      if (patch.speech === true) {
        return next.map((m, i) => (i === idx ? m : { ...m, speech: false }))
      }
      return next
    })
  }

  const applyPreset = (idx: number, preset: ProviderPreset) => {
    const p = PROVIDER_PRESETS[preset]
    updateRow(idx, {
      provider: preset,
      protocol: p.protocol,
      baseURL: p.baseURL,
      apiKeySecret: p.keyHint,
    })
  }

  const addRow = () => {
    setDraft((cur) => [...(cur ?? data ?? []), blankModel()])
  }

  const removeRow = (idx: number) => {
    setDraft((cur) => (cur ?? data ?? []).filter((_, i) => i !== idx))
  }

  return (
    <PageShell
      title="Chat Models"
      icon={Bot}
      iconClassName="text-violet-400"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          <Button size="sm" variant="ghost" className="gap-1" onClick={addRow}>
            <Plus className="w-4 h-4" />
            Add model
          </Button>
          <Button
            size="sm"
            disabled={!dirty || hasErrors || save.isPending}
            onClick={() => save.mutate(models)}
            className="gap-1"
          >
            {save.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save
          </Button>
        </>
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
                Add at least one model to enable the in-process chat. With
                no models, the chat dropdown shows only{" "}
                <strong className="text-white/60">Kody Live</strong> (the
                GitHub Actions engine). Each model uses its own API key
                stored under{" "}
                <Link href="/secrets" className="text-white/60 hover:text-white/80 underline">
                  /secrets
                </Link>{" "}
                — no shared gateway, no per-token middleman.
              </p>
              <Button size="sm" onClick={addRow} className="gap-1">
                <Plus className="w-4 h-4" />
                Add your first model
              </Button>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-3">
          {models.map((m, idx) => {
            const e = allErrors[idx]
            return (
              <li key={idx}>
                <Card className="border-white/[0.08] bg-white/[0.03]">
                  <CardContent className="p-3 space-y-3">
                    {/* Row header: provider preset + label + remove */}
                    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 items-end">
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Provider
                        </Label>
                        <select
                          value={m.provider}
                          onChange={(ev) =>
                            applyPreset(idx, ev.target.value as ProviderPreset)
                          }
                          className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-xs"
                        >
                          {PROVIDER_PRESET_IDS.map((p) => (
                            <option key={p} value={p}>
                              {PROVIDER_PRESETS[p].label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Display label
                        </Label>
                        <Input
                          value={m.label}
                          onChange={(ev) =>
                            updateRow(idx, { label: ev.target.value })
                          }
                          placeholder="Claude Sonnet 4.6"
                          className="text-xs"
                        />
                        {e.label && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {e.label}
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-rose-300 hover:text-rose-200 mb-px"
                        onClick={() => removeRow(idx)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove
                      </Button>
                    </div>

                    {/* Identity + model + protocol */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Internal id
                        </Label>
                        <Input
                          value={m.id}
                          onChange={(ev) =>
                            updateRow(idx, { id: ev.target.value.trim() })
                          }
                          placeholder="anthropic/claude-sonnet-4-6"
                          className="font-mono text-xs"
                        />
                        {e.id && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {e.id}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Model name (sent on the wire)
                        </Label>
                        <Input
                          value={m.modelName}
                          onChange={(ev) =>
                            updateRow(idx, { modelName: ev.target.value.trim() })
                          }
                          placeholder="claude-sonnet-4-6"
                          className="font-mono text-xs"
                        />
                        {e.modelName && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {e.modelName}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Protocol
                        </Label>
                        <select
                          value={m.protocol}
                          onChange={(ev) =>
                            updateRow(idx, {
                              protocol: ev.target.value as ChatProtocol,
                            })
                          }
                          className="w-full h-9 rounded-md border border-white/[0.08] bg-background px-2 text-xs font-mono"
                        >
                          <option value="anthropic">anthropic</option>
                          <option value="openai">openai</option>
                        </select>
                      </div>
                    </div>

                    {/* Endpoint + key */}
                    <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Base URL
                        </Label>
                        <Input
                          value={m.baseURL}
                          onChange={(ev) =>
                            updateRow(idx, { baseURL: ev.target.value.trim() })
                          }
                          placeholder="https://api.anthropic.com/v1"
                          className="font-mono text-xs"
                        />
                        {e.baseURL && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {e.baseURL}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-white/50">
                          API key secret name
                        </Label>
                        <Input
                          value={m.apiKeySecret}
                          onChange={(ev) =>
                            updateRow(idx, {
                              apiKeySecret: ev.target.value.toUpperCase(),
                            })
                          }
                          placeholder="ANTHROPIC_API_KEY"
                          className="font-mono text-xs"
                        />
                        {e.apiKeySecret && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {e.apiKeySecret}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Flags */}
                    <div className="flex items-center gap-4 pt-1">
                      <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                        <Checkbox
                          checked={m.enabled !== false}
                          onCheckedChange={(checked) =>
                            updateRow(idx, { enabled: checked === true })
                          }
                        />
                        Enabled (visible in dropdown)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                        <Checkbox
                          checked={m.speech === true}
                          onCheckedChange={(checked) =>
                            updateRow(idx, { speech: checked === true })
                          }
                        />
                        <Mic className="w-3.5 h-3.5 text-white/40" />
                        Use for voice (kody-speech)
                      </label>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>

        {speechCount > 1 && (
          <p className="text-xs text-rose-300">
            Only one model can be marked as the voice model.
          </p>
        )}

        <p className="text-[11px] text-white/30 pt-4">
          Each model uses its own API key stored under{" "}
          <Link href="/secrets" className="text-white/60 hover:text-white/80 underline">
            /secrets
          </Link>
          . Anthropic-protocol models talk to Claude&apos;s native Messages
          API (prompt caching + thinking control). OpenAI-protocol models
          cover everything else — Gemini, GPT, Groq, OpenRouter, Mistral,
          xAI, self-hosted LiteLLM, etc. With no models or a missing key
          the chat falls back to{" "}
          <strong className="text-white/60">Kody Live</strong>.
        </p>
      </div>
    </PageShell>
  )
}
