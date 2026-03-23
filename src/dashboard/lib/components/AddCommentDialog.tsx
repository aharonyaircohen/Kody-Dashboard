/**
 * @fileType component
 * @domain kody
 * @pattern add-comment-dialog
 * @ai-summary Dialog with markdown editor to add a simple comment on a PR (without @kody action)
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
import { MessageSquare, Loader2, Eye, Edit } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AddCommentDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (body: string) => Promise<void>
  prNumber: number
}

export function AddCommentDialog({ isOpen, onClose, onSubmit, prNumber }: AddCommentDialogProps) {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const handleSubmit = async () => {
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await onSubmit(body.trim())
      setBody('')
      setShowPreview(false)
      onClose()
    } catch {
      // Error handled by caller
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setBody('')
    setShowPreview(false)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-400" />
            Add Comment on PR #{prNumber}
          </DialogTitle>
          <DialogDescription>
            Write a comment. This will be posted directly on the PR (without triggering Kody).
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your comment here...&#10;&#10;Supports **markdown**."
              className="w-full h-40 px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 placeholder:text-zinc-600 font-mono"
              autoFocus
            />
          ) : (
            <div className="min-h-[160px] px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg overflow-y-auto">
              {body.trim() ? (
                <div className="prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-zinc-600 text-sm italic">Nothing to preview</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!body.trim() || submitting}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <MessageSquare className="w-4 h-4 mr-2" />
                Add Comment
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
