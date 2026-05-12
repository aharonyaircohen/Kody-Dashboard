/**
 * @fileType component
 * @domain kody
 * @pattern view-switch
 * @ai-summary Segmented toggle (List ↔ Vibe) that swaps the dashboard view.
 *   Navigates between `/` and `/vibe`; visually a pill switch.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { List, Sparkles } from 'lucide-react'

import { cn } from '@dashboard/lib/utils/ui'
import { SimpleTooltip } from './SimpleTooltip'

const ITEMS = [
  { href: '/', label: 'List', icon: List },
  { href: '/vibe', label: 'Vibe', icon: Sparkles },
] as const

export function ViewSwitch({ className }: { className?: string }) {
  const pathname = usePathname() ?? '/'
  const activeHref = pathname.startsWith('/vibe') ? '/vibe' : '/'

  return (
    <div
      role="tablist"
      aria-label="Dashboard view"
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-md border border-white/[0.08] bg-black/30',
        className,
      )}
    >
      {ITEMS.map((item) => {
        const Icon = item.icon
        const active = activeHref === item.href
        return (
          <SimpleTooltip key={item.href} content={item.label}>
            <Link
              href={item.href}
              role="tab"
              aria-selected={active}
              aria-label={item.label}
              className={cn(
                'flex items-center gap-1.5 px-2.5 h-7 rounded text-xs font-medium transition-colors',
                active
                  ? 'bg-white/10 text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.04]',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </Link>
          </SimpleTooltip>
        )
      })}
    </div>
  )
}
