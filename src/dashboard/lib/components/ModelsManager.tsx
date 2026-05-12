/**
 * @fileType component
 * @domain variables
 * @pattern models-manager
 * @ai-summary CRUD UI for the chat model list (LLM_MODELS variable). Each
 *   row is a Vercel AI Gateway model id with a label, enabled flag, and an
 *   optional speech flag (at most one). The list drives the chat dropdown
 *   across dashboard and /vibe; both surfaces fall back to Kody Live when
 *   the list is empty or the gateway key is missing.
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

interface ChatModel {
  id: string
  label: string
  enabled?: boolean
  speech?: boolean
}

const modelsQueryKey = ["kody-chat-models"] as const
const ID_RE = /^[a-z0-9._-]+\/[a-zA-Z0-9._:-]+$/i

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

  // Local draft state — the user can reorder/edit several rows before saving.
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

  const speechCount = models.filter((m) => m.speech).length
  const idErrors = models.map((m) => {
    if (!m.id) return "Required"
    if (!ID_RE.test(m.id)) return "Must be <provider>/<model>"
    return null
  })
  const dupCount = new Map<string, number>()
  for (const m of models) {
    dupCount.set(m.id, (dupCount.get(m.id) ?? 0) + 1)
  }
  const duplicateIds = new Set(
    Array.from(dupCount.entries())
      .filter(([, n]) => n > 1)
      .map(([id]) => id),
  )
  const hasErrors =
    speechCount > 1 ||
    idErrors.some(Boolean) ||
    duplicateIds.size > 0 ||
    models.some((m) => !m.label.trim())

  const updateRow = (idx: number, patch: Partial<ChatModel>) => {
    setDraft((cur) => {
      const base = cur ?? data ?? []
      const next = base.map((m, i) => (i === idx ? { ...m, ...patch } : m))
      // Enforce single speech flag client-side: setting one clears others.
      if (patch.speech === true) {
        return next.map((m, i) => (i === idx ? m : { ...m, speech: false }))
      }
      return next
    })
  }

  const addRow = () => {
    setDraft((cur) => {
      const base = cur ?? data ?? []
      return [
        ...base,
        {
          id: "",
          label: "",
          enabled: true,
          speech: false,
        },
      ]
    })
  }

  const removeRow = (idx: number) => {
    setDraft((cur) => {
      const base = cur ?? data ?? []
      return base.filter((_, i) => i !== idx)
    })
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
                Add at least one model to enable the in-process chat. With no
                models, the chat dropdown shows only{" "}
                <strong className="text-white/60">Kody Live</strong> (GitHub
                Actions engine). Model ids use the{" "}
                <code className="text-white/55">&lt;provider&gt;/&lt;model&gt;</code>{" "}
                format Vercel AI Gateway expects, e.g.{" "}
                <code className="text-white/55">anthropic/claude-sonnet-4-6</code>.
              </p>
              <Button size="sm" onClick={addRow} className="gap-1">
                <Plus className="w-4 h-4" />
                Add your first model
              </Button>
            </CardContent>
          </Card>
        )}

        <ul className="space-y-2">
          {models.map((m, idx) => {
            const idError = idErrors[idx]
            const isDup = m.id && duplicateIds.has(m.id)
            const labelError = m.label.trim() ? null : "Required"
            return (
              <li key={idx}>
                <Card className="border-white/[0.08] bg-white/[0.03]">
                  <CardContent className="p-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start">
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Gateway model id
                        </Label>
                        <Input
                          value={m.id}
                          onChange={(e) =>
                            updateRow(idx, { id: e.target.value.trim() })
                          }
                          placeholder="anthropic/claude-sonnet-4-6"
                          className="font-mono text-xs"
                        />
                        {(idError || isDup) && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {idError || "Duplicate id"}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-[11px] text-white/50">
                          Label
                        </Label>
                        <Input
                          value={m.label}
                          onChange={(e) =>
                            updateRow(idx, { label: e.target.value })
                          }
                          placeholder="Claude Sonnet 4.6"
                          className="text-xs"
                        />
                        {labelError && (
                          <p className="text-[11px] text-rose-300 mt-1">
                            {labelError}
                          </p>
                        )}
                      </div>
                      <div className="flex items-end gap-1 h-full">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-rose-300 hover:text-rose-200"
                          onClick={() => removeRow(idx)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </Button>
                      </div>
                    </div>
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
                        Use for kody-speech (voice)
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
            Only one model can be marked as the speech model.
          </p>
        )}

        <p className="text-[11px] text-white/30 pt-4">
          Models route through Vercel AI Gateway using the{" "}
          <code className="text-white/50">AI_GATEWAY_API_KEY</code> secret. With
          no models or no gateway key, the chat falls back to{" "}
          <strong className="text-white/60">Kody Live</strong> (GitHub Actions
          engine). Manage the gateway key under{" "}
          <Link href="/secrets" className="text-white/60 hover:text-white/80 underline">
            /secrets
          </Link>
          .
        </p>
      </div>
    </PageShell>
  )
}
