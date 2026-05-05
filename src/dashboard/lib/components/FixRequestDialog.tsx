/**
 * @fileType component
 * @domain kody
 * @pattern fix-request-dialog
 * @ai-summary Dialog with markdown editor to request fixes on a PR via @kody fix
 */
'use client'

import { useState } from 'react'
import { Button } from '@dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dashboard/ui/dialog'
import { Wrench, Loader2, Eye, Edit } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface FixRequestDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (description: string) => Promise<void>
  prNumber: number
}

export function FixRequestDialog({ isOpen, onClose, onSubmit, prNumber }: FixRequestDialogProps) {
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const handleSubmit = async () => {
    if (!description.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(description.trim())
      setDescription('')
      setShowPreview(false)
      onClose()
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-orange-400" />
            Request Fix on PR #{prNumber}
          </DialogTitle>
          <DialogDescription>
            Describe what needs to be fixed. This will post{' '}
            <code className="text-orange-400">@kody fix</code> on the PR.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Editor / Preview toggle */}
          <div className="flex items-center gap-1 border-b border-zinc-800 pb-2">
            <button
              onClick={() => setShowPreview(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                !showPreview ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Edit className="w-3 h-3" /> Write
            </button>
            <button
              onClick={() => setShowPreview(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                showPreview ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
          </div>

          {/* Editor */}
          {!showPreview ? (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the fix needed...&#10;&#10;e.g., The button text should be 'Save' not 'Submit'. Also fix the padding on mobile."
              className="w-full h-40 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-orange-500/50 placeholder:text-zinc-600 font-mono"
              autoFocus
            />
          ) : (
            <div className="min-h-[160px] px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg overflow-y-auto">
              {description.trim() ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{description}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-zinc-600 text-sm italic">Nothing to preview</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!description.trim() || submitting}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <Wrench className="w-4 h-4 mr-2" />
                Request Fix
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
