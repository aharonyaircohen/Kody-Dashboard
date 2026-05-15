/**
 * @fileType component
 * @domain instructions
 * @pattern instructions-manager
 * @ai-summary Editor for `.kody/instructions.md` — the per-repo user
 *   instructions appended to every kody-direct chat turn. Single
 *   textarea + quick-toggle checkboxes for the three most common
 *   knobs (terse, no markdown, no preambles).
 */
"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ExternalLink, Loader2, RotateCcw, Save, ScrollText, Trash2 } from "lucide-react"
import Link from "next/link"
import { PageShell } from "./PageShell"
import { Button } from "@dashboard/ui/button"
import { Card, CardContent } from "@dashboard/ui/card"
import { Checkbox } from "@dashboard/ui/checkbox"
import { Label } from "@dashboard/ui/label"
import { Textarea } from "@dashboard/ui/textarea"
import { ConfirmDialog } from "./ConfirmDialog"
import { AuthGuard } from "../auth-guard"
import { useAuth, buildAuthHeaders } from "../auth-context"

interface InstructionsResource {
  body: string
  sha: string
  updatedAt: string
  htmlUrl: string
}

interface QuickToggleDef {
  id: string
  label: string
  description: string
  line: string
}

const QUICK_TOGGLES: readonly QuickToggleDef[] = [
  {
    id: "terse",
    label: "Terse answers",
    description:
      "One-sentence answers by default. Expand only if I ask 'why' / 'how' / 'show me'.",
    line: "Be terse. Default to one-sentence answers; expand only when I ask for more detail.",
  },
  {
    id: "no-markdown",
    label: "No markdown formatting",
    description: "Plain prose only — no headings, bullets, or bold.",
    line: "Reply in plain prose. No headings, no bullet lists, no bold or italic.",
  },
  {
    id: "no-preamble",
    label: "No preambles or trailing summaries",
    description: "Just the answer — no 'Of course!', no 'In summary…'.",
    line: "Skip preambles and trailing summaries. Answer directly.",
  },
] as const

const instructionsQueryKey = ["kody-instructions"] as const

async function fetchInstructions(
  headers: Record<string, string>,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", { headers })
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null
    error?: string
    message?: string
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
  return json.instructions ?? null
}

async function saveInstructions(
  headers: Record<string, string>,
  body: string,
  sha: string | undefined,
  actorLogin: string | undefined,
): Promise<InstructionsResource | null> {
  const res = await fetch("/api/kody/instructions", {
    method: "PUT",
    headers,
    body: JSON.stringify({ body, sha, actorLogin }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    instructions?: InstructionsResource | null
    error?: string
    message?: string
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
  return json.instructions ?? null
}

async function deleteInstructions(
  headers: Record<string, string>,
): Promise<void> {
  const res = await fetch("/api/kody/instructions", {
    method: "DELETE",
    headers,
  })
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    message?: string
  }
  if (!res.ok) {
    throw new Error(json.message || json.error || `HTTP ${res.status}`)
  }
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso)
    const ms = Date.now() - d.getTime()
    const sec = Math.floor(ms / 1000)
    if (sec < 60) return "just now"
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 30) return `${day}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}

export function InstructionsManager() {
  return (
    <AuthGuard>
      <InstructionsManagerInner />
    </AuthGuard>
  )
}

function InstructionsManagerInner() {
  const { auth } = useAuth()
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...buildAuthHeaders(auth),
  }
  const actorLogin = auth?.user.login

  const queryClient = useQueryClient()
  const { data, isLoading, error, refetch } = useQuery<InstructionsResource | null>({
    queryKey: instructionsQueryKey,
    queryFn: () => fetchInstructions(headers),
    enabled: !!auth,
    staleTime: 30_000,
  })

  const [draft, setDraft] = useState<string>("")
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (data) setDraft(data.body)
    else if (data === null) setDraft("")
  }, [data])

  const dirty = useMemo(() => draft !== (data?.body ?? ""), [draft, data])

  const save = useMutation({
    mutationFn: () => saveInstructions(headers, draft, data?.sha, actorLogin),
    onSuccess: (res) => {
      queryClient.setQueryData(instructionsQueryKey, res)
      toast.success("Instructions saved")
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to save instructions"),
  })

  const remove = useMutation({
    mutationFn: () => deleteInstructions(headers),
    onSuccess: () => {
      queryClient.setQueryData(instructionsQueryKey, null)
      setDraft("")
      toast.success("Instructions removed")
    },
    onError: (err: Error) =>
      toast.error(err.message || "Failed to delete instructions"),
  })

  const toggleLines = useMemo(() => {
    const present = new Set<string>()
    for (const t of QUICK_TOGGLES) {
      if (draft.includes(t.line)) present.add(t.id)
    }
    return present
  }, [draft])

  function applyToggle(id: string, on: boolean) {
    const toggle = QUICK_TOGGLES.find((t) => t.id === id)
    if (!toggle) return
    const line = toggle.line
    if (on) {
      if (draft.includes(line)) return
      const prefix = draft.trim().length > 0 ? `${draft.trimEnd()}\n` : ""
      setDraft(`${prefix}${line}\n`)
    } else {
      const without = draft
        .split(/\r?\n/)
        .filter((row) => row !== line)
        .join("\n")
      setDraft(without)
    }
  }

  return (
    <PageShell
      title="Instructions"
      icon={ScrollText}
      iconClassName="text-cyan-300"
      subtitle={auth ? `${auth.owner}/${auth.repo}` : undefined}
      actions={
        <>
          {data?.htmlUrl && (
            <Button asChild variant="ghost" size="sm" className="gap-1">
              <Link
                href={data.htmlUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="View on GitHub"
              >
                <ExternalLink className="w-4 h-4" />
                On GitHub
              </Link>
            </Button>
          )}
          {data && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-rose-300 hover:text-rose-200"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </Button>
          )}
          <Button
            size="sm"
            className="gap-1"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-white/60">
          Free-form markdown appended to every chat turn for the in-process Kody
          agent. Use it to set tone, length, formatting, or behavioral
          preferences for this repo. Stored at{" "}
          <code className="text-white/80">.kody/instructions.md</code>.
        </p>

        {isLoading && (
          <p className="text-sm text-white/50 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading instructions…
          </p>
        )}

        {error && (
          <Card className="border-rose-500/30 bg-rose-950/20">
            <CardContent className="p-4 text-sm">
              <p className="text-rose-300 font-medium">
                Couldn&apos;t load instructions
              </p>
              <p className="text-rose-200/70 mt-1">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 gap-1"
                onClick={() => refetch()}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && (
          <>
            <Card className="border-white/[0.08] bg-white/[0.03]">
              <CardContent className="p-4 space-y-3">
                <p className="text-xs uppercase tracking-wide text-white/40">
                  Quick toggles
                </p>
                <ul className="space-y-2">
                  {QUICK_TOGGLES.map((t) => {
                    const checked = toggleLines.has(t.id)
                    return (
                      <li key={t.id} className="flex items-start gap-3">
                        <Checkbox
                          id={`toggle-${t.id}`}
                          checked={checked}
                          onCheckedChange={(v) => applyToggle(t.id, v === true)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <Label
                            htmlFor={`toggle-${t.id}`}
                            className="text-sm text-white/85 cursor-pointer"
                          >
                            {t.label}
                          </Label>
                          <p className="text-xs text-white/50 mt-0.5">
                            {t.description}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-[11px] text-white/30">
                  Toggles just append or remove canned lines in the textarea
                  below — edit freely.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label
                htmlFor="instructions-body"
                className="text-sm text-white/70"
              >
                Instructions
              </Label>
              <Textarea
                id="instructions-body"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Default to one-sentence answers. Always cite file paths when referencing code. Prefer Tailwind over inline styles."
                className="min-h-[280px] font-mono text-sm"
              />
              <p className="text-[11px] text-white/30">
                {data?.updatedAt
                  ? `Last saved ${formatRelative(data.updatedAt)}.`
                  : "Not saved yet."}{" "}
                Hard rules in the base agent prompt (never fake tool calls,
                research before evaluating) still win over your instructions.
              </p>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove instructions?"
        description="The .kody/instructions.md file will be deleted from the repo. Chat falls back to the base agent prompt only."
        confirmLabel={remove.isPending ? "Removing…" : "Remove"}
        variant="destructive"
        onConfirm={() => {
          remove.mutate()
          setConfirmDelete(false)
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </PageShell>
  )
}
