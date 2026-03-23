/**
 * @fileType component
 * @domain kody
 * @pattern create-task-dialog
 * @ai-summary Structured task creation dialog with category-specific fields,
 *   similar to BugReportDialog but for features, enhancements, refactors, etc.
 */
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Button } from '@dashboard/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dashboard/ui/dialog'
import { Input } from '@dashboard/ui/input'
import { Label } from '@dashboard/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/ui/select'
import { Textarea } from '@dashboard/ui/textarea'
import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { useCreateTask, useKodyBoards, useCollaborators } from '../hooks'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import {
  Upload,
  X,
  Sparkles,
  Wrench,
  FolderSync,
  FileText,
  Cog,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react'
import { cn } from '@dashboard/lib/utils/ui'
import { PRIORITY_LEVELS, PRIORITY_META, type PriorityLevel } from '../constants'

interface CreateTaskDialogProps {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  initialData?: {
    title: string
    body: string
    labels?: string[]
    assignees?: string[]
  }
}

interface AttachmentFile {
  name: string
  content: string
  preview?: string
  type: string
}

type TaskCategory = 'feature' | 'enhancement' | 'refactor' | 'docs' | 'chore'
type TaskScope = 'frontend' | 'backend' | 'fullstack' | 'infra' | 'ci-cd'

const CATEGORY_META: Record<
  TaskCategory,
  { icon: React.ReactNode; label: string; description: string; color: string }
> = {
  feature: {
    icon: <Sparkles className="w-4 h-4" />,
    label: 'New Feature',
    description: 'Brand-new capability that does not exist yet',
    color: 'text-emerald-600 dark:text-emerald-400',
  },
  enhancement: {
    icon: <Wrench className="w-4 h-4" />,
    label: 'Enhancement',
    description: 'Improve an existing feature or flow',
    color: 'text-blue-600 dark:text-blue-400',
  },
  refactor: {
    icon: <FolderSync className="w-4 h-4" />,
    label: 'Refactor',
    description: 'Restructure code without changing behavior',
    color: 'text-amber-600 dark:text-amber-400',
  },
  docs: {
    icon: <FileText className="w-4 h-4" />,
    label: 'Documentation',
    description: 'Add or update docs, READMEs, comments',
    color: 'text-purple-600 dark:text-purple-400',
  },
  chore: {
    icon: <Cog className="w-4 h-4" />,
    label: 'Chore',
    description: 'Dependencies, config, tooling, cleanup',
    color: 'text-gray-600 dark:text-gray-400',
  },
}

const SCOPE_OPTIONS: { value: TaskScope; label: string }[] = [
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'fullstack', label: 'Full-stack' },
  { value: 'infra', label: 'Infrastructure' },
  { value: 'ci-cd', label: 'CI / CD' },
]

export function CreateTaskDialog({ open, onClose, onCreated, initialData }: CreateTaskDialogProps) {
  // --- Form state ---
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TaskCategory>('feature')
  const [scope, setScope] = useState<TaskScope>('fullstack')
  const [priority, setPriority] = useState<PriorityLevel>('P2')
  const [mode, setMode] = useState('full')

  // Structured description fields
  const [summary, setSummary] = useState('')
  const [requirements, setRequirements] = useState('')
  const [affectedArea, setAffectedArea] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [additionalContext, setAdditionalContext] = useState('')

  // Labels & assignees
  const [labels, setLabels] = useState<string[]>([])
  const [assignees, setAssignees] = useState<string[]>([])

  // Attachments
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [isDragging, setIsDragging] = useState(false)

  // Advanced section toggle
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Hooks
  const { data: collaborators = [] } = useCollaborators()
  const { data: boards = [] } = useKodyBoards()
  const { githubUser } = useGitHubIdentity()
  const createTask = useCreateTask()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Extract labels from boards
  const availableLabels = boards
    .filter((b) => b.type === 'label')
    .flatMap((b) => (b as { labels?: Array<{ name: string; color: string }> }).labels || [])
    .slice(0, 20)

  // --- Reset on close ---
  useEffect(() => {
    if (!open) {
      setTitle('')
      setCategory('feature')
      setScope('fullstack')
      setPriority('P2')
      setMode('full')
      setSummary('')
      setRequirements('')
      setAffectedArea('')
      setAcceptanceCriteria('')
      setAdditionalContext('')
      setLabels([])
      setAssignees([])
      setAttachments([])
      setShowAdvanced(false)
    }
  }, [open])

  // --- Handle initialData for duplication ---
  useEffect(() => {
    if (open && initialData) {
      setTitle(`Copy of ${initialData.title}`)
      // Put the raw body into summary for duplication — user can reorganize
      setSummary(initialData.body)
      setLabels(initialData.labels || [])
      setAssignees(initialData.assignees || [])
    }
  }, [open, initialData])

  // --- File handling ---
  const processFile = useCallback((file: File): Promise<AttachmentFile> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve({
          name: file.name,
          content: result.split(',')[1],
          preview: file.type.startsWith('image/') ? result : undefined,
          type: file.type,
        })
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }, [])

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files) return
      const newAttachments: AttachmentFile[] = []
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) continue
        try {
          newAttachments.push(await processFile(file))
        } catch {
          /* skip failed files */
        }
      }
      setAttachments((prev) => [...prev, ...newAttachments].slice(0, 5))
    },
    [processFile],
  )

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      handleFileSelect(e.dataTransfer.files)
    },
    [handleFileSelect],
  )

  // --- Format body ---
  const formatBody = (): string => {
    const catMeta = CATEGORY_META[category]
    const scopeLabel = SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope
    const prioMeta = PRIORITY_META[priority]

    let body = `# ${catMeta.label}: ${title}\n\n`

    body += `| | |\n|---|---|\n`
    body += `| **Category** | ${catMeta.label} |\n`
    body += `| **Scope** | ${scopeLabel} |\n`
    body += `| **Priority** | ${prioMeta.badge} ${priority} — ${prioMeta.label} |\n\n`

    body += '## Summary\n'
    body += `${summary || '_No summary provided_'}\n\n`

    if (category === 'feature' || category === 'enhancement') {
      body += '## Requirements\n'
      body += `${requirements || '_No requirements specified_'}\n\n`
    }

    if (category === 'refactor') {
      body += '## What to Refactor\n'
      body += `${requirements || '_Not specified_'}\n\n`
    }

    if (category === 'docs') {
      body += '## Documentation Scope\n'
      body += `${requirements || '_Not specified_'}\n\n`
    }

    if (category === 'chore') {
      body += '## What Needs to Change\n'
      body += `${requirements || '_Not specified_'}\n\n`
    }

    if (affectedArea) {
      body += '## Affected Area\n'
      body += `${affectedArea}\n\n`
    }

    if (acceptanceCriteria) {
      body += '## Acceptance Criteria\n'
      body += `${acceptanceCriteria}\n\n`
    }

    if (additionalContext) {
      body += '## Additional Context\n'
      body += `${additionalContext}\n\n`
    }

    return body
  }

  // --- Submit ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const body = formatBody()
    const autoLabels = [...labels, `priority:${priority}`]
    // Auto-add category label if not already present
    if (!autoLabels.includes(category)) {
      autoLabels.push(category)
    }

    createTask.mutate(
      {
        title,
        body,
        mode,
        labels: autoLabels,
        assignees,
        attachments:
          attachments.length > 0
            ? attachments.map((a) => ({ name: a.name, content: a.content }))
            : undefined,
        actorLogin: githubUser?.login,
      },
      {
        onSuccess: () => {
          onCreated?.()
          onClose()
        },
      },
    )
  }

  const toggleLabel = (label: string) => {
    setLabels((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]))
  }

  const toggleAssignee = (login: string) => {
    setAssignees((prev) =>
      prev.includes(login) ? prev.filter((a) => a !== login) : [...prev, login],
    )
  }

  // --- Placeholders per category ---
  const getRequirementsPlaceholder = (): string => {
    switch (category) {
      case 'feature':
        return '- User can …\n- System should …\n- When X happens, then Y'
      case 'enhancement':
        return '- Currently it works like …\n- It should instead …\n- Edge case to handle: …'
      case 'refactor':
        return '- Move X from … to …\n- Extract shared logic into …\n- Replace pattern A with B'
      case 'docs':
        return '- Add README for …\n- Update API docs for …\n- Add JSDoc to …'
      case 'chore':
        return '- Upgrade package X to v…\n- Update config for …\n- Remove deprecated …'
    }
  }

  const getRequirementsLabel = (): string => {
    switch (category) {
      case 'feature':
        return 'Requirements'
      case 'enhancement':
        return 'What to Improve'
      case 'refactor':
        return 'What to Refactor'
      case 'docs':
        return 'Documentation Scope'
      case 'chore':
        return 'What Needs to Change'
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialData ? 'Duplicate Task' : 'Create New Task'}</DialogTitle>
          <DialogDescription>
            Fill in the structured fields below — Kody will use them to plan and implement.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          {createTask.error && (
            <div className="p-2 bg-destructive/10 text-destructive text-sm rounded">
              {createTask.error.message}
            </div>
          )}

          {/* ── Category picker ── */}
          <div className="grid gap-2">
            <Label>
              Category <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(CATEGORY_META) as TaskCategory[]).map((cat) => {
                const meta = CATEGORY_META[cat]
                const selected = category === cat
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border p-2 transition-all text-center',
                      selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'border-border hover:border-muted-foreground/50 hover:bg-muted/50',
                    )}
                  >
                    <span className={cn(selected ? meta.color : 'text-muted-foreground')}>
                      {meta.icon}
                    </span>
                    <span
                      className={cn(
                        'text-[11px] font-medium leading-tight',
                        selected ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" />
              {CATEGORY_META[category].description}
            </p>
          </div>

          {/* ── Title ── */}
          <div className="grid gap-2">
            <Label htmlFor="task-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                category === 'feature'
                  ? 'e.g., Add dark mode toggle to settings page'
                  : category === 'enhancement'
                    ? 'e.g., Improve search results ranking'
                    : category === 'refactor'
                      ? 'e.g., Extract auth logic into shared middleware'
                      : category === 'docs'
                        ? 'e.g., Add API endpoint documentation'
                        : 'e.g., Upgrade Next.js to v15'
              }
              required
              autoFocus
            />
          </div>

          {/* ── Scope + Priority row ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="task-scope">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as TaskScope)}>
                <SelectTrigger id="task-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as PriorityLevel)}>
                <SelectTrigger id="task-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_LEVELS.map((level) => (
                    <SelectItem key={level} value={level}>
                      {PRIORITY_META[level].badge} {level} — {PRIORITY_META[level].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Summary ── */}
          <div className="grid gap-2">
            <Label htmlFor="task-summary">
              Summary <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="task-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the goal in 2-3 sentences. What problem does this solve and for whom?"
              rows={3}
              required
            />
          </div>

          {/* ── Requirements / What to change (label changes per category) ── */}
          <div className="grid gap-2">
            <Label htmlFor="task-requirements">{getRequirementsLabel()}</Label>
            <Textarea
              id="task-requirements"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder={getRequirementsPlaceholder()}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Use bullet points for individual items. Markdown supported.
            </p>
          </div>

          {/* ── Affected area ── */}
          <div className="grid gap-2">
            <Label htmlFor="task-area">Affected Area / Files</Label>
            <Input
              id="task-area"
              value={affectedArea}
              onChange={(e) => setAffectedArea(e.target.value)}
              placeholder="e.g., src/ui/kody/, src/server/payload/collections/Users.ts"
            />
            <p className="text-xs text-muted-foreground">
              Helps Kody focus on the right part of the codebase.
            </p>
          </div>

          {/* ── Acceptance criteria ── */}
          <div className="grid gap-2">
            <Label htmlFor="task-ac">Acceptance Criteria</Label>
            <Textarea
              id="task-ac"
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder={'- [ ] Users can …\n- [ ] Tests pass for …\n- [ ] No regressions in …'}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Checkboxes Kody will verify before marking done.
            </p>
          </div>

          {/* ── Attachments ── */}
          <div className="grid gap-2">
            <Label>Attachments (screenshots, mockups)</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files)}
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachments.map((file, index) => (
                  <div key={index} className="relative group">
                    {file.preview ? (
                      <Image
                        src={file.preview}
                        alt={file.name}
                        width={64}
                        height={64}
                        className="w-16 h-16 object-cover rounded-md border"
                      />
                    ) : (
                      <div className="w-16 h-16 bg-muted flex items-center justify-center rounded-md border">
                        <span className="text-[10px] text-muted-foreground truncate px-1">
                          {file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {attachments.length < 5 && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-colors',
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50',
                )}
              >
                <Upload className="w-4 h-4 mx-auto mb-1 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Drop screenshots here or <span className="text-primary">browse</span>
                </p>
              </div>
            )}
          </div>

          {/* ── Advanced section (collapsible) ── */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            {showAdvanced ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
            Advanced options
            {(assignees.length > 0 || labels.length > 0 || additionalContext) && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                configured
              </span>
            )}
          </button>

          {showAdvanced && (
            <div className="grid gap-4 pl-2 border-l-2 border-border">
              {/* Mode */}
              <div className="grid gap-2">
                <Label htmlFor="task-mode">Pipeline Mode</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger id="task-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full (spec → implement)</SelectItem>
                    <SelectItem value="spec">Spec only</SelectItem>
                    <SelectItem value="impl">Implementation only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Additional context */}
              <div className="grid gap-2">
                <Label htmlFor="task-context">Additional Context</Label>
                <Textarea
                  id="task-context"
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="Links, design references, related issues, constraints..."
                  rows={2}
                />
              </div>

              {/* Labels */}
              <div className="grid gap-2">
                <Label>Labels</Label>
                <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
                  {availableLabels.length === 0 ? (
                    <span className="text-muted-foreground text-xs">No labels available</span>
                  ) : (
                    availableLabels.slice(0, 10).map((label) => (
                      <Button
                        key={label.name}
                        type="button"
                        variant={labels.includes(label.name) ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleLabel(label.name)}
                        className="text-xs h-6"
                      >
                        {label.name}
                      </Button>
                    ))
                  )}
                </div>
              </div>

              {/* Assignees */}
              <div className="grid gap-2">
                <Label>Assignees</Label>
                <div className="flex flex-wrap gap-1 max-h-[80px] overflow-y-auto">
                  {collaborators.length === 0 ? (
                    <span className="text-muted-foreground text-xs">No collaborators</span>
                  ) : (
                    collaborators.slice(0, 10).map((user) => (
                      <Button
                        key={user.login}
                        type="button"
                        variant={assignees.includes(user.login) ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => toggleAssignee(user.login)}
                        className="text-xs h-6 gap-1"
                      >
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={user.avatar_url} alt={user.login} />
                          <AvatarFallback>{user.login[0]?.toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {user.login}
                      </Button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Submit ── */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={createTask.isPending}>
              {createTask.isPending ? 'Creating...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
