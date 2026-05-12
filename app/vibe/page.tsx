/**
 * @fileType page
 * @domain kody
 * @pattern dashboard-page
 * @ai-summary Vibe Coding page — chat + live preview iframe + issue list.
 *   Selecting an issue swaps both chat scope and preview. Merging removes
 *   the issue from the list (it closes server-side).
 */
import { AuthGuard } from '@dashboard/lib/auth-guard'
import { VibePage } from '@dashboard/lib/components/VibePage'
import { buildKodyMetadata } from '../metadata'

export const dynamic = 'force-static'
export const revalidate = false
export const fetchCache = 'force-cache'

export const metadata = buildKodyMetadata({
  title: 'Vibe — Kody',
  description: 'Chat-driven preview, approve, and ship.',
  path: '/vibe',
})

export default function VibeRoute() {
  return (
    <AuthGuard>
      <VibePage />
    </AuthGuard>
  )
}
