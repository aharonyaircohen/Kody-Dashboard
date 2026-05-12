/**
 * @fileType layout
 * @domain layout
 * @pattern chat-rail-layout
 * @ai-summary Shared Next.js layout for routes that should always render
 *   alongside the persistent KodyChat rail (settings, secrets,
 *   notifications, reports, repositories, scenarios). Because this
 *   layout sits above every page in the group, Next.js keeps the chat
 *   instance mounted as the user navigates between these routes — chat
 *   scroll position, streaming state, and session history are preserved
 *   instead of resetting on every page change.
 *
 *   Pages that own a different chat experience (the dashboard root and
 *   /jobs each embed their own KodyChat) live outside this group on
 *   purpose.
 */
import type { ReactNode } from "react"
import { AuthGuard } from "@dashboard/lib/auth-guard"
import { PageWithChat } from "@dashboard/lib/components/PageWithChat"

export default function ChatRailLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <PageWithChat>{children}</PageWithChat>
    </AuthGuard>
  )
}
