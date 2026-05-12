/**
 * @fileType component
 * @domain kody
 * @pattern vibe
 * @ai-summary Inline editor for the Vibe page's default preview URL. Shown
 *   on the empty preview pane when no issue is selected. Persists to
 *   `.kody/dashboard.json` via `/api/kody/dashboard-config` (PUT). The
 *   parent owns the value + save mutation; this component is presentation.
 */
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@dashboard/ui/button'
import { Input } from '@dashboard/ui/input'
import { Loader2, Save } from 'lucide-react'

interface VibeDefaultPreviewFieldProps {
  value: string
  onSave: (next: string) => Promise<void>
  isSaving: boolean
}

export function VibeDefaultPreviewField({
  value,
  onSave,
  isSaving,
}: VibeDefaultPreviewFieldProps) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)

  // Re-sync local draft when the upstream value resolves (initial load,
  // refetch after save). Stops the input from looking empty while the
  // GET is in flight.
  useEffect(() => {
    setDraft(value)
  }, [value])

  const trimmed = draft.trim()
  const dirty = trimmed !== value.trim()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (trimmed) {
      try {
        new URL(trimmed)
      } catch {
        setError('Must be a valid URL (https://...)')
        return
      }
    }
    try {
      await onSave(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-xl mx-auto flex flex-col gap-3"
    >
      <div className="space-y-1.5">
        <label
          htmlFor="vibe-default-preview"
          className="text-xs font-medium text-zinc-300"
        >
          Default preview URL
        </label>
        <p className="text-[11px] text-zinc-500">
          Shown when no issue is selected. Stored per repo at{' '}
          <code className="text-zinc-400">.kody/dashboard.json</code>.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="vibe-default-preview"
          type="url"
          placeholder="https://kody-aguy.vercel.app"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={isSaving}
          className="flex-1"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!dirty || isSaving}
          className="gap-1.5"
        >
          {isSaving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}
