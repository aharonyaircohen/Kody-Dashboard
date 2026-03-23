/**
 * @fileType component
 * @domain kody
 * @pattern badge
 * @ai-summary Task type badge
 */
import { cn } from '../utils'

interface TaskTypeBadgeProps {
  type: string
  className?: string
}

const typeConfig: Record<string, { bg: string; text: string; label: string }> = {
  implement_feature: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Feature' },
  fix_bug: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Bug' },
  refactor: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Refactor' },
  docs: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Docs' },
  ops: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Ops' },
  research: { bg: 'bg-pink-500/20', text: 'text-pink-400', label: 'Research' },
  spec_only: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Spec Only' },
}

export function TaskTypeBadge({ type, className }: TaskTypeBadgeProps) {
  const config = typeConfig[type] || { bg: 'bg-muted', text: 'text-muted-foreground', label: type }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        config.bg,
        config.text,
        className,
      )}
    >
      {config.label}
    </span>
  )
}
