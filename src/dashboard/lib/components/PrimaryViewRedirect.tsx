/**
 * @fileType component
 * @domain kody
 * @pattern primary-view-redirect
 * @ai-summary Client redirect rendered at `/`. Reads the user's last primary
 *   view from localStorage (default: chat) and replaces the URL with /chat or
 *   /tasks. Kept as a thin client component so app/page.tsx stays a static
 *   server page (OG metadata survives for crawlers); the redirect runs only in
 *   the browser, where localStorage exists.
 */
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { readPrimaryView } from "./ViewToggle";

export function PrimaryViewRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(readPrimaryView() === "tasks" ? "/tasks" : "/chat");
  }, [router]);

  return null;
}
