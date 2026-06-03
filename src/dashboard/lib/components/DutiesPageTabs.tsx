/**
 * @fileType component
 * @domain kody
 * @pattern duties-page-tabs
 * @ai-summary Tabbed shell for the Duties page — renders Duty Control or
 *   Reports under a single route. Active tab is mirrored to the URL
 *   (`?tab=reports`) so it survives reloads and shares cleanly.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { cn } from "@dashboard/lib/utils/ui";
import { DutyControl } from "./DutyControl";
import { ExecutablesManager } from "./ExecutablesManager";
import { ReportsView } from "./ReportsView";
import { SimpleTooltip } from "./SimpleTooltip";

type Tab = "duties" | "pipeline" | "reports";

const TABS: { id: Tab; label: string }[] = [
  { id: "duties", label: "Scheduled" },
  { id: "pipeline", label: "Pipeline" },
  { id: "reports", label: "Reports" },
];

function parseTab(value: string | null | undefined): Tab {
  if (value === "reports") return "reports";
  if (value === "pipeline") return "pipeline";
  return "duties";
}

export function DutiesPageTabs() {
  const router = useRouter();
  const pathname = usePathname() ?? "/duties";
  const searchParams = useSearchParams();
  const [active, setActive] = useState<Tab>(() =>
    parseTab(searchParams?.get("tab")),
  );

  // Keep state in sync if the URL changes (back/forward, deep links).
  useEffect(() => {
    setActive(parseTab(searchParams?.get("tab")));
  }, [searchParams]);

  const onSelect = useCallback(
    (id: Tab) => {
      setActive(id);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (id === "duties") params.delete("tab");
      else params.set("tab", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 md:px-6 pt-3 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-2 min-w-0">
          <SimpleTooltip content="Back to dashboard" side="bottom">
            <Button
              asChild
              variant="ghost"
              size="sm"
              aria-label="Back to dashboard"
            >
              <Link href="/">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
          </SimpleTooltip>
          <div
            role="tablist"
            aria-label="Duties view"
            className="flex items-center gap-1"
          >
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`duties-tab-panel-${tab.id}`}
                  onClick={() => onSelect(tab.id)}
                  className={cn(
                    "relative px-3 py-2 text-sm font-medium transition-colors",
                    "border-b-2 -mb-px",
                    isActive
                      ? "text-foreground border-emerald-500"
                      : "text-muted-foreground border-transparent hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        id={`duties-tab-panel-${active}`}
        role="tabpanel"
        className="flex-1 min-h-0 overflow-hidden"
      >
        {active === "duties" ? (
          <DutyControl embedded />
        ) : active === "pipeline" ? (
          <ExecutablesManager />
        ) : (
          <ReportsView embedded />
        )}
      </div>
    </div>
  );
}
