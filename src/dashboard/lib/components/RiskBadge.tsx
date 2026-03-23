/**
 * @fileType component
 * @domain kody
 * @pattern badge
 * @ai-summary Risk level badge
 */
import { cn } from '../utils'

interface RiskBadgeProps {
  level: 'low' | 'medium' | 'high'
  className?: string
}

const riskConfig: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Low' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium' },
  high: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'High' },
}

export function RiskBadge({ level, className }: RiskBadgeProps) {
  const config = riskConfig[level] || riskConfig.low

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        config.bg,
        config.text,
        className,
      )}
    >
      {config.label} Risk
    </span>
  )
}
