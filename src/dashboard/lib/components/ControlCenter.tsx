/**
 * @fileType component
 * @domain kody
 * @pattern control-center-tabs
 * @ai-summary Host page for Missions and Goals. Renders a tab bar in place of
 *   the page title and swaps between the two panels. Each panel remains a
 *   standalone, AuthGuard-wrapped component with its own data and actions.
 */
'use client'

import { useState } from 'react'
import { Flag, Target } from 'lucide-react'
import { cn } from '../utils'
import { MissionControl } from './MissionControl'
import { GoalControl } from './GoalControl'

type Tab = 'missions' | 'goals'

export function ControlCenter() {
  const [tab, setTab] = useState<Tab>('missions')

  const tabs = <ControlTabs active={tab} onChange={setTab} />

  return tab === 'missions' ? (
    <MissionControl titleSlot={tabs} />
  ) : (
    <GoalControl titleSlot={tabs} />
  )
}

function ControlTabs({
  active,
  onChange,
}: {
  active: Tab
  onChange: (tab: Tab) => void
}) {
  return (
    <div
      role="tablist"
      aria-label="Switch between missions and goals"
      className="relative inline-flex items-center rounded-md border border-border bg-black/30 p-0.5 h-8"
    >
      <TabButton
        active={active === 'missions'}
        onClick={() => onChange('missions')}
        label="Missions"
        icon={<Target className="w-3.5 h-3.5" />}
        activeColor="text-emerald-400"
      />
      <TabButton
        active={active === 'goals'}
        onClick={() => onChange('goals')}
        label="Goals"
        icon={<Flag className="w-3.5 h-3.5" />}
        activeColor="text-sky-400"
      />
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  activeColor,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: React.ReactNode
  activeColor: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 h-7 rounded text-sm transition-colors',
        active
          ? cn('bg-white/10 font-medium shadow-sm', activeColor)
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
