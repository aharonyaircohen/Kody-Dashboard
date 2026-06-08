#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateReportText } from "./report-schema-validator.mjs";

const repo =
  argValue("--repo") ||
  process.env.GOAL98_REPO ||
  "aharonyaircohen/Kody-Dashboard";
const defaultRepo = "aharonyaircohen/Kody-Dashboard";
const since = argValue("--since") || "2026-05-25";
const until = argValue("--until") || new Date().toISOString().slice(0, 10);
const limit = argValue("--limit") || "200";
const fetchComments = process.argv.includes("--comments");
const reportSource =
  argValue("--report-source") || (repo === defaultRepo ? "local" : "remote");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function labelNames(issue) {
  return (issue.labels || []).map((label) => label.name);
}

function hasTerminalLabel(issue) {
  const labels = labelNames(issue);
  return labels.includes("kody:done") || labels.includes("kody:failed");
}

function hasGoal98Label(issue) {
  return labelNames(issue).includes("goal:ai-company-orchestration-7-gap-plan");
}

function markerText(issue) {
  const parts = [issue.body || ""];
  for (const comment of issue.comments || []) parts.push(comment.body || "");
  return parts.join("\n");
}

function hasClaimOrDoneMarker(issue) {
  return /<!--\s*(claim|done)\s*:/i.test(markerText(issue));
}

function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\bdocs\b/g, "doc")
    .replace(/\bdoc-coverage\b/g, "doc coverage")
    .replace(/\bdoc coverage gap\b/g, "doc coverage")
    .replace(/[^\w/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\/$/, "");
}

function validateReportFiles(files, schemaExists) {
  const invalid = files
    .map((file) => validateReportText(file.name, file.text))
    .filter((result) => !result.ok)
    .map((result) => ({ file: result.file, errors: result.errors }));

  return {
    source: reportSource,
    schemaExists,
    files: files.length,
    valid: files.length - invalid.length,
    invalid,
  };
}

function localReportSchemaStatus() {
  const dir = ".kody/reports";
  if (!existsSync(dir)) {
    return {
      source: "local",
      files: 0,
      valid: 0,
      invalid: [],
      schemaExists: false,
    };
  }

  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".md") && !file.startsWith("_"))
    .sort()
    .map((file) => ({
      name: file,
      text: readFileSync(join(dir, file), "utf8"),
    }));

  return validateReportFiles(files, existsSync(join(dir, "_schema.yaml")));
}

function remoteReportSchemaStatus() {
  let entries;
  try {
    entries = JSON.parse(gh(["api", `repos/${repo}/contents/.kody/reports`]));
  } catch {
    return {
      source: "remote",
      files: 0,
      valid: 0,
      invalid: [],
      schemaExists: false,
      error: "Could not read .kody/reports from the target repo.",
    };
  }

  const files = [];
  for (const entry of entries.filter((item) => item.type === "file")) {
    if (entry.name === "_schema.yaml") continue;
    if (!entry.name.endsWith(".md") || entry.name.startsWith("_")) continue;

    const encodedPath = entry.path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const detail = JSON.parse(
      gh(["api", `repos/${repo}/contents/${encodedPath}`]),
    );
    const text = Buffer.from(detail.content || "", "base64").toString("utf8");
    files.push({ name: entry.name, text });
  }

  return validateReportFiles(
    files.sort((a, b) => a.name.localeCompare(b.name)),
    entries.some((entry) => entry.name === "_schema.yaml"),
  );
}

function reportSchemaStatus() {
  return reportSource === "remote"
    ? remoteReportSchemaStatus()
    : localReportSchemaStatus();
}

function getIssueComments(number) {
  const query = `query($owner:String!, $repo:String!, $number:Int!) {
    repository(owner:$owner, name:$repo) {
      issue(number:$number) {
        comments(first:50) {
          nodes { body createdAt author { login } }
        }
      }
    }
  }`;
  const [owner, name] = repo.split("/");
  const output = gh([
    "api",
    "graphql",
    "-F",
    `owner=${owner}`,
    "-F",
    `repo=${name}`,
    "-F",
    `number=${number}`,
    "-f",
    `query=${query}`,
  ]);
  return JSON.parse(output).data.repository.issue.comments.nodes;
}

function loadIssues() {
  const search = `created:>=${since} created:<=${until} -label:kody:audit-log -label:kody:control`;
  const output = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    search,
    "--json",
    "number,title,state,labels,createdAt,closedAt,updatedAt,body,url",
    "--limit",
    limit,
  ]);
  const issues = JSON.parse(output);

  if (fetchComments) {
    for (const issue of issues.filter((item) => item.state === "CLOSED")) {
      issue.comments = getIssueComments(issue.number);
    }
  }

  return issues;
}

function groupDuplicates(issues) {
  const groups = new Map();
  for (const issue of issues) {
    const key = normalizeTitle(issue.title);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(issue);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      issues: group.map((issue) => `#${issue.number} ${issue.title}`),
    }));
}

function main() {
  let issues;
  try {
    issues = loadIssues();
  } catch (error) {
    console.error(
      "Could not load GitHub issues. Missing: GitHub network/auth via gh.",
    );
    console.error(String(error.stderr || error.message || error));
    process.exit(1);
  }

  const closed = issues.filter((issue) => issue.state === "CLOSED");
  const closedWithMarkers = closed.filter(hasClaimOrDoneMarker);
  const closedWithTerminalLabel = closed.filter(hasTerminalLabel);
  const duplicates = groupDuplicates(issues);
  const reports = reportSchemaStatus();
  const goal98Issues = issues.filter(hasGoal98Label);

  const result = {
    repo,
    window: { since, until },
    commentsIncluded: fetchComments,
    issues: {
      total: issues.length,
      closed: closed.length,
      goal98Attached: goal98Issues.length,
      closedWithClaimOrDoneMarker: closedWithMarkers.length,
      closedMarkerCoverage:
        closed.length === 0
          ? null
          : Number((closedWithMarkers.length / closed.length).toFixed(3)),
      closedWithTerminalLabel: closedWithTerminalLabel.length,
      duplicateTitleClusters: duplicates.length,
      duplicateClusters: duplicates,
    },
    reports: {
      source: reports.source,
      schemaExists: reports.schemaExists,
      files: reports.files,
      valid: reports.valid,
      invalid: reports.invalid,
      error: reports.error,
      schemaCoverage:
        reports.files === 0
          ? null
          : Number((reports.valid / reports.files).toFixed(3)),
    },
    missingForFinalVerdict: [
      "Let the #90 and #91 changes run on real new work.",
      "Run the same script after 7-14 days.",
      "Add 5 manual timing samples for 'how long to understand what happened here'.",
      "Decide whether to count all issues or only Kody-owned issues in the final read.",
    ],
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
