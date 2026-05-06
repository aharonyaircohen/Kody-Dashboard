/**
 * @fileType page
 * @domain vault
 * @pattern secrets-page
 * @ai-summary Secrets management entry point. Renders under AuthGuard
 *   (handled inside the manager component).
 */
import { SecretsManager } from "@dashboard/lib/components/SecretsManager"
import { buildKodyMetadata } from "../metadata"

export const dynamic = "force-static"
export const revalidate = false
export const fetchCache = "force-cache"

export const metadata = buildKodyMetadata({
  title: "Secrets — Kody Operations Dashboard",
  description:
    "Manage API keys and secrets stored in the encrypted .kody/secrets.enc vault.",
  path: "/secrets",
})

export default function SecretsPage() {
  return <SecretsManager />
}
