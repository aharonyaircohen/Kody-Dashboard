/**
 * @fileType page
 * @domain variables
 * @pattern variables-page
 * @ai-summary Variables management entry point. Renders inside the shared
 *   PageWithChat shell so the assistant is always available.
 */
import { VariablesManager } from "@dashboard/lib/components/VariablesManager"
import { buildKodyMetadata } from "../../metadata"

export const dynamic = "force-static"
export const revalidate = false
export const fetchCache = "force-cache"

export const metadata = buildKodyMetadata({
  title: "Variables — Kody Operations Dashboard",
  description:
    "Manage non-sensitive config stored in .kody/variables.json. For secrets use /secrets.",
  path: "/variables",
})

export default function VariablesPage() {
  return <VariablesManager />
}
