/**
 * @fileType component
 * @domain kody
 * @pattern jobs-page-tabs
 * @ai-summary Tabbed shell for the Jobs page — renders Job Control or
 *   Reports under a single route. Active tab is mirrored to the URL
 *   (`?tab=reports`) so it survives reloads and shares cleanly.
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { cn } from '@dashboard/lib/utils/ui'
import { JobControl } from './JobControl'
import { ReportsView } from './ReportsView'

type Tab = 'jobs' | 'reports'

const TABS: { id: Tab; label: string }[] = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'reports', label: 'Job Reports' },
]

function parseTab(value: string | null | undefined): Tab {
  return value === 'reports' ? 'reports' : 'jobs'
}

export function JobsPageTabs() {
  const router = useRouter()
  const pathname = usePathname() ?? '/jobs'
  const searchParams = useSearchParams()
  const [active, setActive] = useState<Tab>(() =>
    parseTab(searchParams?.get('tab')),
  )

  // Keep state in sync if the URL changes (back/forward, deep links).
  useEffect(() => {
    setActive(parseTab(searchParams?.get('tab')))
  }, [searchParams])

  const onSelect = useCallback(
    (id: Tab) => {
      setActive(id)
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (id === 'jobs') params.delete('tab')
      else params.set('tab', id)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        role="tablist"
        aria-label="Jobs view"
        className="shrink-0 flex items-center gap-1 px-4 md:px-6 pt-3 border-b border-white/[0.06] bg-black/30"
      >
        {TABS.map((tab) => {
          const isActive = active === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`jobs-tab-panel-${tab.id}`}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'relative px-3 py-2 text-sm font-medium transition-colors',
                'border-b-2 -mb-px',
                isActive
                  ? 'text-foreground border-emerald-500'
                  : 'text-muted-foreground border-transparent hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div
        id={`jobs-tab-panel-${active}`}
        role="tabpanel"
        className="flex-1 min-h-0 overflow-hidden"
      >
        {active === 'jobs' ? <JobControl /> : <ReportsView />}
      </div>
    </div>
  )
}
