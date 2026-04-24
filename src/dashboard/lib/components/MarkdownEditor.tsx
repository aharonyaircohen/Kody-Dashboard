/**
 * @fileType component
 * @domain kody
 * @pattern markdown-editor
 * @ai-summary Controlled markdown editor with toolbar (bold/italic/code/link/list/heading/quote),
 *   emoji picker, and preview toggle. Extracted so Mission Control and future
 *   issue-body edits share one implementation.
 */
'use client'

import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bold, Italic, Code, Link2, List, Heading, Quote, Eye } from 'lucide-react'
import { Button } from '@dashboard/ui/button'
import { Textarea } from '@dashboard/ui/textarea'
import { cn } from '@dashboard/lib/utils/ui'
import { EMOJI_LIST } from '../constants'

interface MarkdownEditorProps {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
  className?: string
  /** Optional override for the preview empty-state message */
  emptyPreview?: string
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 8,
  disabled,
  className,
  emptyPreview = '*Nothing to preview*',
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertMarkdown = (before: string, after: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = value.slice(start, end)
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)

    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  const insertEmoji = (emoji: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const next = value.slice(0, start) + emoji + value.slice(start)
    onChange(next)
    setShowEmojiPicker(false)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
  }

  return (
    <div className={cn('space-y-2', className)}>
      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-0.5 border border-border rounded-md p-1 bg-muted/30">
        <ToolbarButton title="Bold" onClick={() => insertMarkdown('**', '**')}>
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => insertMarkdown('*', '*')}>
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Code" onClick={() => insertMarkdown('`', '`')}>
          <Code className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Link" onClick={() => insertMarkdown('[', '](url)')}>
          <Link2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Heading" onClick={() => insertMarkdown('## ')}>
          <Heading className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Quote" onClick={() => insertMarkdown('> ')}>
          <Quote className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton title="List" onClick={() => insertMarkdown('- ')}>
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>

        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            className="h-7 w-7 p-0 text-sm"
            title="Emoji"
          >
            😊
          </Button>
          {showEmojiPicker ? (
            <div className="absolute z-20 top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto border border-border rounded-md shadow-lg bg-popover p-2 grid grid-cols-6 gap-1">
              {EMOJI_LIST.slice(0, 60).map((emoji, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => insertEmoji(emoji)}
                  className="p-1 hover:bg-accent rounded text-lg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          type="button"
          variant={showPreview ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowPreview((prev) => !prev)}
          className="h-7 px-2 text-xs"
          title={showPreview ? 'Edit' : 'Preview'}
        >
          <Eye className="w-3.5 h-3.5 mr-1" />
          {showPreview ? 'Edit' : 'Preview'}
        </Button>
      </div>

      {/* Editor / preview */}
      {showPreview ? (
        <div className="min-h-[120px] p-3 border border-border rounded-md bg-background prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{value || emptyPreview}</ReactMarkdown>
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          className="font-mono text-sm resize-y"
        />
      )}
    </div>
  )
}

function ToolbarButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-7 w-7 p-0"
      title={title}
    >
      {children}
    </Button>
  )
}
