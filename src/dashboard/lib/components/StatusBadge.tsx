/**
 * @fileType component
 * @domain kody
 * @pattern badge
 * @ai-summary Status badge for pipeline state
 */
import { cn } from '../utils'

interface StatusBadgeProps {
  status: 'running' | 'completed' | 'failed' | 'timeout' | 'pending' | 'gate-waiting'
  className?: string
}

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  running: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Running' },
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Completed' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Failed' },
  timeout: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Timeout' },
  pending: { bg: 'bg-muted', text: 'text-muted-foreground', label: 'Pending' },
  'gate-waiting': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Needs Approval' },
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending

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
