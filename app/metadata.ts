/**
 * @fileType utility
 * @domain kody
 * @pattern metadata-helper
 * @ai-summary Shared metadata builders for Kody dashboard routes with OG/Twitter tags
 */
import type { Metadata } from "next";
import { fetchIssue } from "@dashboard/lib/github-client";

const SITE_NAME = "Kody Operations Dashboard";
const BASE_URL =
  process.env.KODY_PUBLIC_SERVER_URL || "https://www.dev.aguy.co.il";
const DEFAULT_IMAGE = `${BASE_URL}/website-template-OG.webp`;

/** Build base metadata with OG + Twitter tags for static kody pages */
export function buildKodyMetadata(options: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const { title, description, path } = options;
  const url = `${BASE_URL}${path}`;

  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      images: [
        {
          url: DEFAULT_IMAGE,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_IMAGE],
    },
    alternates: {
      canonical: url,
    },
  };
}

/** Fetch issue and build dynamic metadata for /[issueNumber] pages */
export async function buildTaskMetadata(
  issueNumber: number,
  options?: { suffix?: string; path?: string },
): Promise<Metadata> {
  const suffix = options?.suffix || "";
  const path = options?.path || `/${issueNumber}`;

  try {
    const issue = await fetchIssue(issueNumber);

    if (!issue) {
      return buildKodyMetadata({
        title: `Task #${issueNumber} — ${SITE_NAME}`,
        description: `Task #${issueNumber} not found`,
        path,
      });
    }

    // Clean title: remove [task-id] prefix brackets if present
    const cleanTitle = issue.title.replace(/^\[[^\]]*\]\s*/, "");

    // Build status from labels
    const statusLabels = issue.labels
      .filter((l) => l.name.startsWith("kody:"))
      .map((l) => l.name.replace("kody:", ""));
    const typeLabels = issue.labels
      .filter((l) => l.name.startsWith("type:"))
      .map((l) => l.name.replace("type:", ""));

    const statusText = statusLabels.length > 0 ? statusLabels[0] : issue.state;
    const typeText = typeLabels.length > 0 ? typeLabels[0] : "";

    const title = `#${issueNumber} ${cleanTitle}${suffix ? ` — ${suffix}` : ""}`;

    // Build a short description from type + status + first 120 chars of body
    const bodySnippet = issue.body
      ? issue.body
          .replace(/[#*_`>\-\[\]()]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120)
      : "";
    const descParts = [
      typeText && `${typeText.charAt(0).toUpperCase() + typeText.slice(1)}`,
      `Status: ${statusText}`,
      bodySnippet && bodySnippet + (bodySnippet.length >= 120 ? "…" : ""),
    ].filter(Boolean);
    const description = descParts.join(" · ");

    return buildKodyMetadata({ title, description, path });
  } catch {
    // If GitHub API fails, return basic metadata (don't block page render)
    return buildKodyMetadata({
      title: `Task #${issueNumber}${suffix ? ` — ${suffix}` : ""} — ${SITE_NAME}`,
      description: `View task #${issueNumber} on the Kody Operations Dashboard`,
      path,
    });
  }
}
