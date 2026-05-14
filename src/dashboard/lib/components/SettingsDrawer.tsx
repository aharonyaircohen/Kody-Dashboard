/**
 * @fileType component
 * @domain kody
 * @pattern settings-drawer
 * @ai-summary Slide-out drawer hosting the configuration nav (Notifications,
 *   Secrets, Variables, Chat Models, Repositories, Settings). Replaces the
 *   persistent left sidebar — invisible by default, opened via the gear
 *   icon in page headers. Trigger is wired through `SettingsDrawerContext`
 *   so any header can call `useSettingsDrawer().open()` without prop drilling.
 */
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Settings as SettingsIcon } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@dashboard/ui/sheet'
import { cn } from '@dashboard/lib/utils/ui'
import { SETTINGS_NAV_SECTIONS } from './settings-nav'

interface SettingsDrawerContextValue {
  open: () => void
  close: () => void
  isOpen: boolean
}

const SettingsDrawerContext = createContext<SettingsDrawerContextValue | null>(
  null,
)

export function SettingsDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const value = useMemo(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  )

  return (
    <SettingsDrawerContext.Provider value={value}>
      {children}
      <SettingsDrawer isOpen={isOpen} onOpenChange={setIsOpen} />
    </SettingsDrawerContext.Provider>
  )
}

export function useSettingsDrawer(): SettingsDrawerContextValue {
  const ctx = useContext(SettingsDrawerContext)
  if (!ctx) {
    // Allow safe no-op usage outside the provider (e.g. server snapshots).
    return { open: () => {}, close: () => {}, isOpen: false }
  }
  return ctx
}

interface SettingsDrawerProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

function SettingsDrawer({ isOpen, onOpenChange }: SettingsDrawerProps) {
  const pathname = usePathname() ?? '/'

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[280px] sm:w-[320px] p-0 flex flex-col bg-black/95 border-white/[0.08]"
      >
        <SheetHeader className="px-4 py-3 border-b border-white/[0.06] space-y-0 text-left">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-emerald-600 flex items-center justify-center text-white font-semibold text-sm">
              K
            </div>
            <SheetTitle className="text-sm font-semibold">Settings</SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Dashboard configuration menus.
          </SheetDescription>
        </SheetHeader>

        <nav className="flex-1 overflow-y-auto p-2 space-y-4">
          {SETTINGS_NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.title}
              </p>
              {section.items.map((item) => {
                const Icon = item.icon
                const active =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {item.label}
                      </span>
                      {item.description && (
                        <span className="block text-[11px] text-muted-foreground/80 truncate">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Convenience trigger button — drop next to other header actions.
 * Calls into the shared drawer context so a single drawer instance
 * services every page.
 */
export function SettingsDrawerTrigger({
  className,
}: {
  className?: string
}) {
  const { open } = useSettingsDrawer()
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open settings"
      className={cn(
        'inline-flex items-center justify-center h-8 w-8 rounded-md border border-white/[0.12]',
        'text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors',
        className,
      )}
    >
      <SettingsIcon className="w-4 h-4" />
    </button>
  )
}
