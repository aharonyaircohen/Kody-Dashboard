/**
 * @fileType component
 * @domain kody
 * @pattern app-sidebar
 * @ai-summary Persistent left navigation rail for the Kody dashboard.
 *   Desktop only (hidden below md). Collapsible (64px ↔ 220px) with
 *   localStorage persistence. Top-level entries are the primary surfaces
 *   (Dashboard, Jobs, Workers); configuration screens are sourced from
 *   the shared `SETTINGS_NAV_SECTIONS` so new pages added there appear
 *   here automatically. Mobile keeps the existing in-header hamburger
 *   menu (MobileMenu) — this rail is the desktop replacement for the
 *   kebab-triggered SettingsDrawer.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Github,
  LogOut,
  Moon,
  Sun,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { useTheme } from '@dashboard/providers/Theme'
import { cn } from '@dashboard/lib/utils/ui'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { SimpleTooltip } from './SimpleTooltip'
import { InboxBadge } from './InboxBadge'
import {
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_SECTIONS,
  type SettingsNavItem,
} from './settings-nav'

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION

type NavItem = SettingsNavItem

const COLLAPSED_KEY = 'kody.sidebar.collapsed'

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

export function Sidebar() {
  const pathname = usePathname() ?? '/'
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity()
  const { theme, setTheme } = useTheme()
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false)
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [hydrated, setHydrated] = useState<boolean>(false)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_KEY) === '1') {
        setCollapsed(true)
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to defaults
    }
    setHydrated(true)
  }, [])

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

  const width = collapsed ? 'w-[64px]' : 'w-[220px]'

  const renderLink = (item: NavItem) => {
    const Icon = item.icon
    const active = isActive(pathname, item)
    const link = (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={item.label}
        className={cn(
          'relative flex items-center gap-3 rounded-md text-sm transition-colors',
          'h-9 px-3',
          collapsed && 'justify-center px-0',
          active
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="truncate">{item.label}</span>}
        {item.href === '/inbox' && (
          <InboxBadge
            className={cn(
              collapsed
                ? 'absolute top-1 right-1'
                : 'ml-auto',
            )}
          />
        )}
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
        <SimpleTooltip
          content={APP_VERSION ? `Kody v${APP_VERSION}` : 'Kody'}
          side="right"
        >
          <Link
            href="/"
            className="flex items-center gap-2 text-foreground hover:text-foreground/80"
            aria-label={APP_VERSION ? `Kody home (v${APP_VERSION})` : 'Kody home'}
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
        </SimpleTooltip>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {PRIMARY_NAV_ITEMS.map((item) => renderLink(item))}

        {/* Configuration surfaces, sourced from the shared settings-nav so
            new pages appear here and in the mobile menu automatically.
            Section headings show only when the rail is expanded; collapsed
            mode is a single flat icon list. */}
        {SETTINGS_NAV_SECTIONS.map((section) => (
          <div key={section.title} className="space-y-1">
            {!collapsed && (
              <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.title}
              </p>
            )}
            {collapsed && (
              <div
                className="my-2 mx-3 border-t border-white/[0.06]"
                aria-hidden="true"
              />
            )}
            {section.items.map((item) => renderLink(item))}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-2 space-y-1">
        {/* GitHub identity — click to reveal connected repo + sign out.
            Persistent app chrome, moved here from the page header. */}
        {(githubUser || connectedRepo) && (
          <div className="relative">
            <SimpleTooltip
              content={
                githubUser
                  ? `@${githubUser.login}${connectedRepo ? ` · ${connectedRepo}` : ''}`
                  : (connectedRepo ?? 'Connected')
              }
              side="right"
            >
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Account"
                className={cn(
                  'flex items-center gap-3 w-full rounded-md text-sm h-9 px-3 transition-colors',
                  'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  collapsed && 'justify-center px-0',
                )}
              >
                {githubUser ? (
                  <Avatar className="h-5 w-5 shrink-0">
                    <AvatarImage
                      src={githubUser.avatar_url}
                      alt={githubUser.login}
                    />
                    <AvatarFallback>
                      {githubUser.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ) : (
                  <Github className="w-4 h-4 shrink-0" />
                )}
                {!collapsed && (
                  <span className="truncate flex-1 text-left">
                    {githubUser ? `@${githubUser.login}` : 'Connected'}
                  </span>
                )}
              </button>
            </SimpleTooltip>
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-56 py-1 bg-popover border rounded-md shadow-lg z-50">
                {connectedRepo && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1">
                    <span className="font-medium text-foreground">Repo:</span>{' '}
                    {connectedRepo}
                  </div>
                )}
                {githubUser ? (
                  <button
                    type="button"
                    onClick={() => {
                      clearGitHubUser()
                      setUserMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    Sign out
                  </button>
                ) : (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground">
                    No GitHub user signed in.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle — global chrome, moved here from the page header. */}
        <SimpleTooltip
          content={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          side="right"
        >
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            }
            className={cn(
              'flex items-center gap-3 w-full rounded-md text-sm h-9 px-3',
              'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 shrink-0" />
            ) : (
              <Moon className="w-4 h-4 shrink-0" />
            )}
            {!collapsed && (
              <span className="truncate">
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </span>
            )}
          </button>
        </SimpleTooltip>

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

        {APP_VERSION && (
          <p
            className={cn(
              'pt-1 text-[10px] font-mono text-muted-foreground/50 select-none',
              collapsed ? 'text-center' : 'px-3',
            )}
          >
            v{APP_VERSION}
          </p>
        )}
      </div>
    </aside>
  )
}
