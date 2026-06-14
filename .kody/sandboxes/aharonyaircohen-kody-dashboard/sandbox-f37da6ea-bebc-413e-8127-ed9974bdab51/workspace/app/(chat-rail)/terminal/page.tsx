/**
 * @fileType page
 * @domain terminal
 * @pattern terminal-page
 * @ai-summary Full-page Fly machine terminal surface. The persistent chat rail
 *   stays mounted beside it like every other dashboard page.
 */
import { Suspense } from "react";
import { TerminalManager } from "@dashboard/lib/components/TerminalManager";
import { buildKodyMetadata } from "../../metadata";

export const dynamic = "force-static";
export const revalidate = false;
export const fetchCache = "force-cache";

export const metadata = buildKodyMetadata({
  title: "Machine Terminal — Kody Operations Dashboard",
  description: "Interactive terminal for live Fly runner and Brain machines.",
  path: "/terminal",
});

export default function TerminalPage() {
  return (
    <Suspense fallback={null}>
      <TerminalManager />
    </Suspense>
  );
}
