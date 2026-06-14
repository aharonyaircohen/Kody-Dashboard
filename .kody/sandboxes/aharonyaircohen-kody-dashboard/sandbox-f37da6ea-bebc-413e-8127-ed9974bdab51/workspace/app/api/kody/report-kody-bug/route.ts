/**
 * @fileType route
 * @domain kody
 * @pattern report-kody-bug
 * @ai-summary POST a bug report about Kody itself (dashboard/engine) into the
 *   dashboard's OWN public repo — not the consumer's connected repo. Attributed
 *   to the reporter's PAT (works on a public repo without collaborator access).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  requireKodyAuth,
} from "@dashboard/lib/auth";
import {
  clearGitHubContext,
  createIssue,
  setGitHubContext,
} from "@dashboard/lib/github-client";
import {
  KODY_BUG_AREAS,
  KODY_BUG_SEVERITIES,
  KODY_REPORT_TARGET,
} from "@dashboard/lib/constants";
import { logger } from "@dashboard/lib/logger";

const diagnosticsSchema = z
  .object({
    userAgent: z.string().optional(),
    platform: z.string().optional(),
    screen: z.string().optional(),
    viewport: z.string().optional(),
    url: z.string().optional(),
    referrer: z.string().optional(),
    timezone: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .optional();

const reportSchema = z.object({
  title: z.string().min(1).max(200),
  area: z.enum(KODY_BUG_AREAS),
  severity: z.enum(KODY_BUG_SEVERITIES),
  whatHappened: z.string().min(1),
  steps: z.string().optional(),
  expected: z.string().optional(),
  where: z.string().optional(),
  reporterLogin: z.string().optional(),
  diagnostics: diagnosticsSchema,
});

type ReportInput = z.infer<typeof reportSchema>;

const SEVERITY_BADGE: Record<(typeof KODY_BUG_SEVERITIES)[number], string> = {
  blocker: "🟥 Blocker",
  major: "🟧 Major",
  minor: "🟨 Minor",
};

function section(heading: string, value?: string): string {
  const body = value?.trim() ? value.trim() : "_Not specified_";
  return `## ${heading}\n${body}\n\n`;
}

function formatBody(input: ReportInput): string {
  const { area, severity, whatHappened, steps, expected, where, diagnostics } =
    input;

  let md = "## Summary\n";
  md += `**Area:** ${area} • **Severity:** ${SEVERITY_BADGE[severity]}\n\n`;
  md += section("What happened", whatHappened);
  md += section("Steps to reproduce", steps);
  md += section("Expected result", expected);
  md += section("Where it happened", where);

  const d = diagnostics ?? {};
  const rows = [
    ["Reported by", input.reporterLogin ? `@${input.reporterLogin}` : null],
    ["URL", d.url],
    ["Came from", d.referrer],
    ["Browser", d.userAgent],
    ["Platform", d.platform],
    ["Screen", d.screen],
    ["Viewport", d.viewport],
    ["Timezone", d.timezone],
    ["Captured at", d.timestamp],
  ].filter(([, v]) => Boolean(v)) as Array<[string, string]>;

  if (rows.length > 0) {
    md += "<details>\n<summary>Diagnostics (auto-captured)</summary>\n\n";
    md += rows.map(([k, v]) => `- **${k}:** ${v}`).join("\n");
    md += "\n\n</details>\n\n";
  }

  md += "---\n_Filed from the Kody dashboard “Report a Kody bug” form._";
  return md;
}

export async function POST(req: NextRequest) {
  const authResult = await requireKodyAuth(req);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const input = reportSchema.parse(await req.json());

    // Always target the dashboard's OWN repo, regardless of the connected repo.
    // Keep the reporter's token so the issue is attributed to them.
    const headerAuth = getRequestAuth(req);
    setGitHubContext(
      KODY_REPORT_TARGET.owner,
      KODY_REPORT_TARGET.repo,
      headerAuth?.token ?? "",
    );

    const userOctokit = await getUserOctokit(req);

    const labels = [
      "bug",
      "kody-report",
      `area:${input.area}`,
      `severity:${input.severity}`,
    ];

    const issue = await createIssue(
      {
        title: `[${input.area}] ${input.title}`,
        body: formatBody(input),
        labels,
      },
      userOctokit ?? undefined,
    );

    logger.info(
      { issue: issue.number, area: input.area, severity: input.severity },
      "Kody bug report filed",
    );

    return NextResponse.json({
      success: true,
      issue: {
        number: issue.number,
        title: issue.title,
        html_url: issue.html_url,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 },
      );
    }
    if (error?.status === 401) {
      return NextResponse.json(
        {
          error: "github_token_expired",
          message: "Your GitHub session expired. Please log in again.",
        },
        { status: 401 },
      );
    }
    if (error?.status === 403 || error?.status === 404) {
      return NextResponse.json(
        {
          error: "cannot_file",
          message:
            "Could not open an issue on the Kody repo. It may be private or have issues disabled.",
        },
        { status: 502 },
      );
    }
    logger.error({ err: error }, "Failed to file Kody bug report");
    return NextResponse.json(
      { error: "Failed to file bug report", details: error?.message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
