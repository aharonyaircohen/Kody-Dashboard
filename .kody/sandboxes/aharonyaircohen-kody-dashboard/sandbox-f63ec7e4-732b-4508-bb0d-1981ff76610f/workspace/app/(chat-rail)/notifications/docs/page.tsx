/**
 * @fileType page
 * @domain kody
 * @pattern notifications-docs
 * @ai-summary Renders docs/notifications.md inside the dashboard so users can
 *   read setup recipes (Slack, Telegram, Discord, generic webhooks for Twilio,
 *   Mattermost, etc.) without leaving the UI.
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
  title: "Notifications docs — Kody Operations Dashboard",
  description:
    "Setup recipes for Slack, Telegram, Discord, and generic-webhook channels.",
  path: "/notifications/docs",
});

async function readDocs(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "docs", "notifications.md");
    return await fs.readFile(file, "utf8");
  } catch {
    return "# Notifications docs\n\nDocs file (`docs/notifications.md`) not found in this build.";
  }
}

export default async function NotificationsDocsPage() {
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
            Back to rules
          </Link>
        </div>
        <a
          href="https://github.com/aharonyaircohen/Kody-Dashboard/blob/main/docs/notifications.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white"
        >
          View on GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </header>
      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto">
        <MarkdownViewer content={content} title="docs/notifications.md" />
      </main>
    </div>
  );
}
