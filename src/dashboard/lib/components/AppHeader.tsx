/**
 * @fileType component
 * @domain kody
 * @pattern app-header
 * @ai-summary The single persistent top header, rendered once by ChatRailShell
 *   at the top of the main content column (right of the nav sidebar). It stays
 *   put across Chat and Tasks — the view switches below it, the header never
 *   disappears. Reuses KodyHeader for the shared chrome (repo title, the
 *   Chat|Tasks ViewToggle, Vibe toggle, notifications, mobile hamburger) with
 *   no page-specific filter/refresh bits — pages render those as their own
 *   toolbar below this header. Not shown on /vibe, which keeps its own header.
 */
"use client";

import { useState } from "react";

import { KodyHeader } from "./KodyHeader";
import { MobileMenu } from "./MobileMenu";

export function AppHeader() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <>
      <KodyHeader
        onOpenMobileMenu={() => setNavOpen(true)}
        onRefresh={() => {}}
        isFetching={false}
        showRefresh={false}
      />
      <MobileMenu open={navOpen} onOpenChange={setNavOpen} />
    </>
  );
}
