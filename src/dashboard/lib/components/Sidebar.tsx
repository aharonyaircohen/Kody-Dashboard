/**
 * @fileType component
 * @domain kody
 * @pattern app-sidebar
 * @ai-summary Persistent left navigation rail for the Kody dashboard.
 *   Desktop only (hidden below md). Collapsible (64px ↔ 220px) with
 *   localStorage persistence. Top-level entries are the primary surfaces
 *   (Dashboard, Jobs); configuration screens live under an expandable
 *   "Settings" group. Mobile keeps the existing in-header hamburger menu.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Github,
  Home,
  KeyRound,
  Layers,
  Settings as SettingsIcon,
  Settings2,
  Sliders,
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

const PRIMARY_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Dashboard', icon: Home, exact: true },
  { href: '/jobs', label: 'Jobs', icon: Layers },
]

const SETTINGS_ITEMS: readonly NavItem[] = [
  { href: '/notifications', label: 'Notifications', icon: Bell },
  { href: '/secrets', label: 'Secrets', icon: KeyRound },
  { href: '/variables', label: 'Variables', icon: Settings2 },
  { href: '/models', label: 'Chat Models', icon: Bot },
  { href: '/repos', label: 'Repositories', icon: Github },
  { href: '/settings', label: 'Settings', icon: Sliders },
]

const COLLAPSED_KEY = 'kody.sidebar.collapsed'
const SETTINGS_OPEN_KEY = 'kody.sidebar.settings.open'

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function isSettingsActive(pathname: string): boolean {
  return SETTINGS_ITEMS.some((item) => isActive(pathname, item))
}

export function Sidebar() {
  const pathname = usePathname() ?? '/'
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [hydrated, setHydrated] = useState<boolean>(false)

  useEffect(() => {
    try {
      const savedCollapsed = window.localStorage.getItem(COLLAPSED_KEY)
      if (savedCollapsed === '1') setCollapsed(true)
      const savedSettings = window.localStorage.getItem(SETTINGS_OPEN_KEY)
      // Auto-open if a settings child is currently active, otherwise honor
      // saved preference (default closed).
      if (isSettingsActive(pathname) || savedSettings === '1') {
        setSettingsOpen(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to defaults
    }
    setHydrated(true)
    // pathname intentionally excluded — we only want to seed once on mount;
    // pathname-driven opening is handled by the second effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Whenever the user navigates into a settings child, ensure the group is open.
  useEffect(() => {
    if (isSettingsActive(pathname)) setSettingsOpen(true)
  }, [pathname])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // ignore — UI still updates
      }
      return next
    })
  }

  const toggleSettings = () => {
    setSettingsOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(SETTINGS_OPEN_KEY, next ? '1' : '0')
      } catch {
        // ignore — UI still updates
      }
      return next
    })
  }

  const width = collapsed ? 'w-[64px]' : 'w-[220px]'
  const settingsActive = isSettingsActive(pathname)

  const renderLink = (item: NavItem, indent = false) => {
    const Icon = item.icon
    const active = isActive(pathname, item)
    const link = (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        className={cn(
          'flex items-center gap-3 rounded-md text-sm transition-colors',
          'h-9 px-3',
          collapsed && 'justify-center px-0',
          indent && !collapsed && 'pl-9',
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
      <div key={item.href}>{link}</div>
    )
  }

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
        {PRIMARY_ITEMS.map((item) => renderLink(item))}

        {/* Settings group — expandable when sidebar is open; flat list of
            icon-only links when collapsed. */}
        {collapsed ? (
          SETTINGS_ITEMS.map((item) => renderLink(item))
        ) : (
          <>
            <button
              type="button"
              onClick={toggleSettings}
              aria-expanded={settingsOpen}
              aria-controls="sidebar-settings-group"
              className={cn(
                'flex items-center gap-3 w-full rounded-md text-sm h-9 px-3',
                settingsActive && !settingsOpen
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <SettingsIcon className="w-4 h-4 shrink-0" />
              <span className="truncate flex-1 text-left">Settings</span>
              <ChevronDown
                className={cn(
                  'w-3.5 h-3.5 shrink-0 transition-transform',
                  !settingsOpen && '-rotate-90',
                )}
              />
            </button>
            {settingsOpen && (
              <div id="sidebar-settings-group" className="space-y-1">
                {SETTINGS_ITEMS.map((item) => renderLink(item, true))}
              </div>
            )}
          </>
        )}
      </nav>

      <div className="border-t border-white/[0.06] p-2">
        <SimpleTooltip
          content={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          side="right"
        >
          <button
            type="button"
            onClick={toggleCollapsed}
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
