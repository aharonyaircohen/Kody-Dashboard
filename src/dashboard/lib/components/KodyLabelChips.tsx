/**
 * @fileType component
 * @domain kody
 * @pattern label-chip
 * @ai-summary Small pill-style chips that render a task's kody:* lifecycle
 *   phase and its kody-flow:* flow type using lucide icons and tinted colors.
 */
'use client'

import {
  Bug,
  Sparkles,
  FileText,
  Wrench,
  CheckCircle2,
  XCircle,
  Tags,
  Search,
  ClipboardList,
  Play,
  Bandage,
  GitMerge,
  Eye,
  RefreshCcw,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '../utils/ui'
import type { KodyPhase, KodyFlow } from '../constants'

interface PhaseMeta {
  label: string
  icon: LucideIcon
  colorClass: string
}

const PHASE_META: Record<KodyPhase, PhaseMeta> = {
  classifying: {
    label: 'Classifying',
    icon: Tags,
    colorClass: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  },
  researching: {
    label: 'Researching',
    icon: Search,
    colorClass: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  },
  planning: {
    label: 'Planning',
    icon: ClipboardList,
    colorClass: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  },
  running: {
    label: 'Running',
    icon: Play,
    colorClass: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  fixing: {
    label: 'Fixing',
    icon: Bandage,
    colorClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  resolving: {
    label: 'Resolving',
    icon: GitMerge,
    colorClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  reviewing: {
    label: 'Reviewing',
    icon: Eye,
    colorClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  syncing: {
    label: 'Syncing',
    icon: RefreshCcw,
    colorClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  orchestrating: {
    label: 'Orchestrating',
    icon: Workflow,
    colorClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  done: {
    label: 'Done',
    icon: CheckCircle2,
    colorClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    colorClass: 'bg-red-500/15 text-red-300 border-red-500/30',
  },
}

interface FlowMeta {
  label: string
  icon: LucideIcon
}

const FLOW_META: Record<KodyFlow, FlowMeta> = {
  feature: { label: 'Feature', icon: Sparkles },
  bug: { label: 'Bug', icon: Bug },
  spec: { label: 'Spec', icon: FileText },
  chore: { label: 'Chore', icon: Wrench },
}

export function KodyPhaseChip({
  phase,
  className,
}: {
  phase: KodyPhase | null
  className?: string
}) {
  if (!phase) return null
  const meta = PHASE_META[phase]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
        meta.colorClass,
        className,
      )}
      title={`Phase: ${meta.label}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}

export function KodyFlowChip({
  flow,
  className,
}: {
  flow: KodyFlow | null
  className?: string
}) {
  if (!flow) return null
  const meta = FLOW_META[flow]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-zinc-800/60 text-zinc-300 border-zinc-700',
        className,
      )}
      title={`Flow: ${meta.label}`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  )
}
