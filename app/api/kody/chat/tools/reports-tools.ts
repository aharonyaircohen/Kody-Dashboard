/**
 * @fileType util
 * @domain reports
 * @pattern chat-tools
 * @ai-summary Read-only chat tools for duty reports (`.kody/reports/<slug>.md`)
 *   — list and read. Reports are the YAML-findings output that scheduled
 *   duties commit each tick; chat can surface and reason over them.
 */
import { tool } from "ai";
import { z } from "zod";
import {
  listReportFiles,
  readReportFile,
  isValidSlug,
} from "@dashboard/lib/reports-files";

export function createReportTools(opts: { owner: string; repo: string }) {
  const repoRef = `${opts.owner}/${opts.repo}`;
  return {
    list_reports: tool({
      description: `List the duty reports in ${repoRef} (.kody/reports/). Returns slug, title, and last-updated for each report a scheduled duty has produced.`,
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const reports = await listReportFiles();
          return {
            reports: reports.map((r) => ({
              slug: r.slug,
              title: r.title,
              updatedAt: r.updatedAt,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    read_report: tool({
      description: `Read one duty report from ${repoRef} in full (the YAML findings + markdown body).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        try {
          const report = await readReportFile(slug);
          if (!report) return { error: `report "${slug}" not found` };
          return { report };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
