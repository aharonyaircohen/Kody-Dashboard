/**
 * @fileType component
 * @domain kody
 * @pattern app-top-bar
 * @ai-summary Thin global top strip rendered above the main content pane in
 *   ChatRailShell. Holds the Chat | Tasks ViewToggle (the primary view switch)
 *   and, on mobile, the hamburger that opens the shared nav sheet (MobileMenu)
 *   — since the desktop Sidebar is hidden below md. Page-specific toolbars
 *   (e.g. the dashboard's FilterBar) still render below this, inside their
 *   own page.
 */
"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@dashboard/ui/button";
import { MobileMenu } from "./MobileMenu";
import { ViewToggle } from "./ViewToggle";

export function AppTopBar() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 px-3 md:px-4 h-12 shrink-0 border-b border-white/[0.06] bg-black/20">
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden -ml-1"
        aria-label="Open menu"
        onClick={() => setNavOpen(true)}
      >
        <Menu className="w-5 h-5" />
      </Button>

      <ViewToggle />

      <MobileMenu open={navOpen} onOpenChange={setNavOpen} />
    </div>
  );
}
