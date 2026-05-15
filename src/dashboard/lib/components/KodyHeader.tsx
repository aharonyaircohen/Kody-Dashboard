/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-header
 * @ai-summary Top action bar shared by the Dashboard and Vibe pages.
 *   Mirrors the dashboard layout so navigating between the two surfaces
 *   feels like a view toggle, not a route change. The only visual delta
 *   between the two pages is the VibeToggle, which reflects the current
 *   route via usePathname.
 *
 *   Page-specific state (notifications, branch cleanup dialog, refetch,
 *   publish callback) is passed in as props so each host owns its own
 *   query/mutation lifecycle. Hooks that are safe to call per-instance
 *   (theme, GitHub identity) are read directly inside the header.
 */
'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  GitBranch,
  Github,
  Layers,
  Menu,
  Moon,
  RefreshCw,
  ScrollText,
  Sun,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@dashboard/ui/avatar'
import { Button } from '@dashboard/ui/button'
import { useGitHubIdentity } from '../hooks/useGitHubIdentity'
import { useTheme } from '@dashboard/providers/Theme'
import { NotificationCenter } from '../notifications/NotificationCenter'
import { useNotifications } from '../notifications/NotificationsProvider'
import { cn } from '../utils'
import { PublishButton } from './PublishButton'
import { SettingsDrawerTrigger } from './SettingsDrawer'
import { SimpleTooltip } from './SimpleTooltip'
import { VibeToggle } from './VibeToggle'

interface KodyHeaderProps {
  /** Called after a successful publish so the host page can focus the new issue. */
  onPublished?: (issueNumber: number) => void

  /** Opens the branch-cleanup dialog (host renders the dialog itself). */
  onOpenBranchCleanup: () => void

  /** Opens the page-specific mobile menu (host renders the Sheet). */
  onOpenMobileMenu: () => void

  /** Refetch hook for the Refresh button; host decides what gets re-fetched. */
  onRefresh: () => void
  isFetching: boolean

  /** Optional slot rendered inline with desktop controls (e.g. PR badge in Vibe). */
  desktopExtras?: ReactNode
  /** Optional slot rendered before the mobile hamburger (e.g. Issues button in Vibe). */
  mobileExtras?: ReactNode
}

export function KodyHeader({
  onPublished,
  onOpenBranchCleanup,
  onOpenMobileMenu,
  onRefresh,
  isFetching,
  desktopExtras,
  mobileExtras,
}: KodyHeaderProps) {
  const { githubUser, connectedRepo, clearGitHubUser } = useGitHubIdentity()
  const { theme, setTheme } = useTheme()
  const {
    store: notificationStore,
    permission: notificationPermission,
    isSupported: notificationsSupported,
    requestPermission,
  } = useNotifications()
  const [showUserDropdown, setShowUserDropdown] = useState(false)

  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/20">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">
            {connectedRepo?.split('/').pop() || 'Kody Operations'}
          </h1>
          {process.env.NEXT_PUBLIC_APP_VERSION ? (
            <span className="text-xs text-muted-foreground font-mono">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          ) : null}
        </div>
        <VibeToggle className="hidden sm:inline-flex" />
      </div>

      {/* Desktop controls */}
      <div className="hidden md:flex items-center gap-3">
        {desktopExtras}

        {/* GitHub identity badge with dropdown */}
        {(githubUser || connectedRepo) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowUserDropdown((prev) => !prev)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent transition-colors max-w-[180px]"
            >
              {githubUser ? (
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage src={githubUser.avatar_url} alt={githubUser.login} />
                  <AvatarFallback>
                    {githubUser.login[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              ) : (
                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <Github className="h-3 w-3 text-muted-foreground" />
                </div>
              )}
              <span className="text-xs text-muted-foreground truncate">
                {githubUser ? `@${githubUser.login}` : 'Connected'}
                {connectedRepo && (
                  <span className="text-muted-foreground/60"> · {connectedRepo}</span>
                )}
              </span>
            </button>
            {showUserDropdown && (
              <div className="absolute top-full right-0 mt-1 w-56 py-1 bg-popover border rounded-md shadow-lg z-50">
                {connectedRepo && (
                  <div className="px-3 py-1.5 text-xs text-muted-foreground border-b mb-1">
                    <span className="font-medium text-foreground">Repo:</span>{' '}
                    {connectedRepo}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    clearGitHubUser()
                    setShowUserDropdown(false)
                  }}
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        )}

        <NotificationCenter
          store={notificationStore}
          browserPermission={notificationPermission}
          isSupported={notificationsSupported}
          onRequestPermission={requestPermission}
        />

        <SimpleTooltip
          content={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          side="bottom"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={
              theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            }
            className="text-muted-foreground"
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </Button>
        </SimpleTooltip>

        <PublishButton actorLogin={githubUser?.login} onPublished={onPublished} />

        <SimpleTooltip content="Jobs" side="bottom">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-1"
            aria-label="Jobs"
          >
            <Link href="/jobs">
              <Layers className="w-4 h-4" />
            </Link>
          </Button>
        </SimpleTooltip>

        <SimpleTooltip content="Changelog" side="bottom">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="gap-1"
            aria-label="Changelog"
          >
            <Link href="/changelog">
              <ScrollText className="w-4 h-4" />
            </Link>
          </Button>
        </SimpleTooltip>

        <SettingsDrawerTrigger />

        <SimpleTooltip content="Clean up branches" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenBranchCleanup}
            aria-label="Clean up branches"
            className="gap-1"
          >
            <GitBranch className="w-4 h-4" />
          </Button>
        </SimpleTooltip>

        <SimpleTooltip content="Refresh" side="bottom">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isFetching}
            aria-label="Refresh"
            className="gap-1"
          >
            <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
          </Button>
        </SimpleTooltip>
      </div>

      {/* Mobile cluster — page-specific extras (e.g. issue picker) + hamburger. */}
      <div className="flex md:hidden items-center gap-1">
        {mobileExtras}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open menu"
          onClick={onOpenMobileMenu}
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>
    </div>
  )
}
