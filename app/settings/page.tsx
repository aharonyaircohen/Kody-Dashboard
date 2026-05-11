/**
 * @fileType page
 * @domain settings
 * @pattern settings-page
 * @ai-summary User credentials management entry point. Renders inside
 *   PageWithChat so the assistant is always available.
 */
import { AuthGuard } from "@dashboard/lib/auth-guard"
import { PageWithChat } from "@dashboard/lib/components/PageWithChat"
import { SettingsManager } from "@dashboard/lib/components/SettingsManager"
import { buildKodyMetadata } from "../metadata"

export const dynamic = "force-static"
export const revalidate = false
export const fetchCache = "force-cache"

export const metadata = buildKodyMetadata({
  title: "Settings — Kody Operations Dashboard",
  description:
    "Manage per-browser credentials: Brain server config, Vercel preview bypass, and sign-out.",
  path: "/settings",
})

export default function SettingsPage() {
  return (
    <AuthGuard>
      <PageWithChat>
        <SettingsManager />
      </PageWithChat>
    </AuthGuard>
  )
}
