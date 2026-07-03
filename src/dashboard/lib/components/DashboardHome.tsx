/**
 * @fileType component
 * @domain kody
 * @pattern dashboard-overview
 * @ai-summary Root dashboard home. The page is intentionally an attention
 *   surface: existing task, CI, report, health, activity, and managed-goal
 *   records are normalized into one operator loop instead of rendered as
 *   separate product concepts.
 */
"use client";

import { useAuth } from "../auth-context";
import { AttentionHome } from "./AttentionHome";
import { RepoManager } from "./RepoManager";

export function DashboardHome() {
  const { auth } = useAuth();

  if (!auth) {
    return <RepoManager />;
  }

  return <AttentionHome />;
}
