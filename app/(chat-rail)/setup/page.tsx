/**
 * @fileType page
 * @domain wizards
 * @pattern wizard-index
 * @ai-summary Setup home: lists every registered wizard; each opens on its
 *   own page at /setup/<slug>.
 */
import { SetupManager } from "@dashboard/lib/components/SetupManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-dynamic";

export const metadata = buildKodyMetadata({
  title: "Setup — Kody Operations Dashboard",
  description: "Guided setup wizards.",
  path: "/setup",
});

export default function SetupIndexPage() {
  return <SetupManager />;
}
