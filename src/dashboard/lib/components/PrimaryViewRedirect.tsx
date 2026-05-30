/**
 * @fileType component
 * @domain kody
 * @pattern primary-view-redirect
 * @ai-summary Client redirect rendered at `/`. Sends the user to /tasks, the
 *   single main view; chat rides along as a collapsible side rail (the old
 *   Chat|Tasks route toggle is gone). Kept as a thin client component so
 *   app/page.tsx stays a static server page (OG metadata survives for
 *   crawlers); the redirect runs only in the browser.
 */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function PrimaryViewRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/tasks");
  }, [router]);

  return null;
}
