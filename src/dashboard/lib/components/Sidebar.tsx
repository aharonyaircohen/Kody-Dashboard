/**
 * @fileType component
 * @domain kody
 * @pattern app-sidebar
 * @ai-summary Persistent left navigation rail for the Kody dashboard.
 *   Desktop only (hidden below md). Collapsible (64px ↔ 220px) with
 *   localStorage persistence. Mobile keeps the existing in-header
 *   hamburger menu in KodyDashboard — this rail intentionally does not
 *   render on small screens.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  FileText,
  Github,
  Home,
  KeyRound,
  Layers,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@dashboard/lib/utils/ui'
import { SimpleTooltip } from './SimpleTooltip'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** When true, only match the exact path (used for the root). */
  exact?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home, exact: true },
  { href: '/jobs', label: 'Jobs', icon: Layers },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/secrets', label: 'Secrets', icon: KeyRound },
  { href: '/repos', label: 'Repositories', icon: Github },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
]

const STORAGE_KEY = 'kody.sidebar.collapsed'

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function Sidebar() {
  const pathname = usePathname() ?? '/'
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [hydrated, setHydrated] = useState<boolean>(false)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      if (saved === '1') setCollapsed(true)
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to default
    }
    setHydrated(true)
  }, [])

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        // ignore — UI still updates
      }
      return next
    })
  }

  const width = collapsed ? 'w-[64px]' : 'w-[220px]'

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col shrink-0 border-r border-white/[0.06] bg-black/30',
        'h-screen sticky top-0 z-30 transition-[width] duration-150 ease-out',
        width,
      )}
      aria-label="Primary navigation"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <div
        className={cn(
          'flex items-center px-3 h-14 border-b border-white/[0.06]',
          collapsed ? 'justify-center' : 'justify-between',
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground hover:text-foreground/80"
          aria-label="Kody home"
        >
          <div className="h-7 w-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-semibold text-sm shrink-0">
            K
          </div>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight truncate">
              Kody
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = isActive(pathname, item)
          const link = (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={cn(
                'flex items-center gap-3 rounded-md text-sm transition-colors',
                'h-9 px-3',
                collapsed && 'justify-center px-0',
                active
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )

          return collapsed ? (
            <SimpleTooltip key={item.href} content={item.label} side="right">
              {link}
            </SimpleTooltip>
          ) : (
            link
          )
        })}
      </nav>

      <div className="border-t border-white/[0.06] p-2">
        <SimpleTooltip
          content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          side="right"
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'flex items-center gap-3 w-full rounded-md text-sm h-9 px-3',
              'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronLeft className="w-4 h-4 shrink-0" />
            )}
            {!collapsed && <span className="truncate">Collapse</span>}
          </button>
        </SimpleTooltip>
      </div>
    </aside>
  )
}
