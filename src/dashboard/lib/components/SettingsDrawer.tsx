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
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { MoreVertical } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@dashboard/ui/sheet";
import { cn } from "@dashboard/lib/utils/ui";
import { SETTINGS_NAV_SECTIONS, isNavItemActive } from "./settings-nav";
import { InboxBadge } from "./InboxBadge";

interface SettingsDrawerContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const SettingsDrawerContext = createContext<SettingsDrawerContextValue | null>(
  null,
);

export function SettingsDrawerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <SettingsDrawerContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <SettingsDrawer isOpen={isOpen} onOpenChange={setIsOpen} />
      </Suspense>
    </SettingsDrawerContext.Provider>
  );
}

export function useSettingsDrawer(): SettingsDrawerContextValue {
  const ctx = useContext(SettingsDrawerContext);
  if (!ctx) {
    // Allow safe no-op usage outside the provider (e.g. server snapshots).
    return { open: () => {}, close: () => {}, isOpen: false };
  }
  return ctx;
}

interface SettingsDrawerProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

function SettingsDrawer({ isOpen, onOpenChange }: SettingsDrawerProps) {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[320px] flex-col border-white/[0.08] bg-black/95 p-0 sm:w-[360px]"
      >
        <SheetHeader className="space-y-0 border-b border-white/[0.06] px-5 py-4 text-left">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-600 text-body-sm font-semibold text-white">
              K
            </div>
            <SheetTitle className="text-heading-md font-semibold">
              Settings
            </SheetTitle>
          </div>
          <SheetDescription className="sr-only">
            Dashboard configuration menus.
          </SheetDescription>
        </SheetHeader>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3">
          {SETTINGS_NAV_SECTIONS.map((section) => (
            <div key={section.title} className="space-y-1">
              <p className="px-3 pb-1 pt-1 text-label font-semibold uppercase tracking-wider text-muted-foreground/60">
                {section.title}
              </p>
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isNavItemActive(pathname, search, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-3.5 rounded-md px-3.5 py-2.5 text-body-sm transition-colors",
                      active
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="mt-0.5 h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="block truncate font-medium">
                          {item.label}
                        </span>
                        {item.href === "/inbox" && <InboxBadge />}
                      </span>
                      {item.description && (
                        <span className="block truncate text-body-xs text-muted-foreground/80">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Convenience trigger button — drop next to other header actions.
 * Calls into the shared drawer context so a single drawer instance
 * services every page.
 */
export function SettingsDrawerTrigger({ className }: { className?: string }) {
  const { open } = useSettingsDrawer();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open settings"
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-md",
        "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors",
        className,
      )}
    >
      <MoreVertical className="h-5 w-5" />
    </button>
  );
}
