/**
 * @fileType component
 * @domain kody
 * @pattern control-tabs
 * @ai-summary Shared tab bar used by /missions and /goals. Each tab is a
 *   Next.js Link so switching updates the URL; no client-side tab state.
 */
'use client'

import Link from 'next/link'
import { Flag, Target } from 'lucide-react'
import { cn } from '../utils'

export type ControlTab = 'missions' | 'goals'

export function ControlTabs({ active }: { active: ControlTab }) {
  return (
    <div
      role="tablist"
      aria-label="Switch between missions and goals"
      className="inline-flex items-center rounded-md border border-border bg-black/30 p-0.5 h-8"
    >
      <TabLink
        href="/missions"
        active={active === 'missions'}
        label="Missions"
        icon={<Target className="w-3.5 h-3.5" />}
        activeColor="text-emerald-400"
      />
      <TabLink
        href="/goals"
        active={active === 'goals'}
        label="Goals"
        icon={<Flag className="w-3.5 h-3.5" />}
        activeColor="text-sky-400"
      />
    </div>
  )
}

function TabLink({
  href,
  active,
  label,
  icon,
  activeColor,
}: {
  href: string
  active: boolean
  label: string
  icon: React.ReactNode
  activeColor: string
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      prefetch
      className={cn(
        'inline-flex items-center gap-1.5 px-3 h-7 rounded text-sm transition-colors',
        active
          ? cn('bg-white/10 font-medium shadow-sm', activeColor)
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </Link>
  )
}
