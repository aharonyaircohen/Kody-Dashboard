/**
 * @fileType page
 * @domain vault
 * @pattern secrets-docs
 * @ai-summary Renders docs/secrets-vault.md inside the dashboard so users can
 *   read setup, threat model, and rotation guidance without leaving the UI.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import Link from "next/link"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { MarkdownViewer } from "@dashboard/lib/components/MarkdownViewer"
import { buildKodyMetadata } from "../../../metadata"

export const dynamic = "force-static"
export const revalidate = false

export const metadata = buildKodyMetadata({
  title: "Secrets vault docs — Kody Operations Dashboard",
  description:
    "How the .kody/secrets.enc vault works, how to set it up, and how to rotate keys.",
  path: "/secrets/docs",
})

async function readDocs(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "docs", "secrets-vault.md")
    return await fs.readFile(file, "utf8")
  } catch {
    return "# Secrets vault docs\n\nDocs file (`docs/secrets-vault.md`) not found in this build."
  }
}

export default async function SecretsDocsPage() {
  const content = await readDocs()
  return (
    <div className="min-h-screen bg-black/95 text-white/90">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-3">
          <Link
            href="/secrets"
            className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to secrets
          </Link>
        </div>
        <a
          href="https://github.com/aharonyaircohen/Kody-Dashboard/blob/main/docs/secrets-vault.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white"
        >
          View on GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </header>
      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto">
        <MarkdownViewer content={content} title="docs/secrets-vault.md" />
      </main>
    </div>
  )
}
