/**
 * @fileType page
 * @domain kody
 * @pattern push-docs
 * @ai-summary Renders docs/push-notifications.md inside the dashboard so
 *   users can read PWA install instructions, the mention-dispatch flow, and
 *   the extending-to-new-features guide without leaving the UI.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { MarkdownViewer } from "@dashboard/lib/components/MarkdownViewer";
import { buildKodyMetadata } from "../../../metadata";

export const dynamic = "force-static";
export const revalidate = false;

export const metadata = buildKodyMetadata({
  title: "Push notifications docs — Kody Operations Dashboard",
  description:
    "How to install Kody as a PWA, enable push on iOS / Android / desktop, and extend push to new features.",
  path: "/notifications/push-docs",
});

async function readDocs(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "docs", "push-notifications.md");
    return await fs.readFile(file, "utf8");
  } catch {
    return "# Push notifications docs\n\nDocs file (`docs/push-notifications.md`) not found in this build.";
  }
}

export default async function PushDocsPage() {
  const content = await readDocs();
  return (
    <div className="min-h-screen bg-black/95 text-white/90">
      <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-white/[0.06] bg-black/30">
        <div className="flex items-center gap-3">
          <Link
            href="/notifications"
            className="inline-flex items-center gap-1 text-sm text-white/60 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to notifications
          </Link>
        </div>
        <a
          href="https://github.com/aharonyaircohen/Kody-Dashboard/blob/main/docs/push-notifications.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white"
        >
          View on GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </header>
      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto">
        <MarkdownViewer
          content={content}
          title="docs/push-notifications.md"
        />
      </main>
    </div>
  );
}
