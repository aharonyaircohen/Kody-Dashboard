/**
 * @fileType page
 * @domain variables
 * @pattern models-page
 * @ai-summary Chat model management entry point. CRUD UI for the LLM_MODELS
 *   variable. Rendered inside the shared PageWithChat shell.
 */
import { ModelsManager } from "@dashboard/lib/components/ModelsManager"
import { buildKodyMetadata } from "../../metadata"

export const dynamic = "force-static"
export const revalidate = false
export const fetchCache = "force-cache"

export const metadata = buildKodyMetadata({
  title: "Chat Models — Kody Operations Dashboard",
  description:
    "Pick the chat models surfaced in the dashboard and /vibe dropdowns. Routes through Vercel AI Gateway.",
  path: "/models",
})

export default function ModelsPage() {
  return <ModelsManager />
}
