#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_REPORT_KEYS = ["generatedAt", "findings"];
const REQUIRED_FINDING_KEYS = ["id", "severity", "title"];
const ALLOWED_SEVERITIES = new Set(["high", "medium", "low"]);
const ALLOWED_REVIEW_STATUSES = new Set([
  "none",
  "info",
  "action-needed",
  "assigned",
  "reviewed",
]);
const ALLOWED_SUGGESTED_ACTION_TYPES = new Set([
  "dispatch",
  "create-task",
  "dismiss",
]);

export function splitFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { frontmatter: null, body: raw };
  return { frontmatter: match[1], body: raw.slice(match[0].length) };
}

function unquote(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function topLevelValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? unquote(match[1]) : null;
}

function parseFindings(frontmatter) {
  return parseObjectList(frontmatter, "findings");
}

function parseObjectList(frontmatter, key) {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^${key}:\\s*$`).test(line),
  );
  if (start < 0) return [];

  const items = [];
  let current = null;

  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;

    const firstKey = line.match(/^\s{2}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (firstKey) {
      current = { [firstKey[1]]: unquote(firstKey[2]) };
      items.push(current);
      continue;
    }

    const nextKey = line.match(/^\s{4}([A-Za-z][\w-]*):\s*(.*)$/);
    if (current && nextKey) {
      current[nextKey[1]] = unquote(nextKey[2]);
    }
  }

  return items;
}

function parsePositiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function validateReportText(file, text) {
  const errors = [];
  const { frontmatter } = splitFrontmatter(text);

  if (!frontmatter) {
    return { file, ok: false, errors: ["missing frontmatter block"] };
  }

  for (const key of REQUIRED_REPORT_KEYS) {
    if (topLevelValue(frontmatter, key) === null) {
      errors.push(`missing ${key}`);
    }
  }

  const generatedAt = topLevelValue(frontmatter, "generatedAt");
  if (generatedAt && Number.isNaN(Date.parse(generatedAt))) {
    errors.push("generatedAt is not a valid date-time");
  }

  const capabilitySlug =
    topLevelValue(frontmatter, "capabilitySlug") ??
    topLevelValue(frontmatter, "capabilitySlug");
  if (capabilitySlug !== null && capabilitySlug.length === 0) {
    errors.push("capabilitySlug is empty");
  }

  const reviewStatus = topLevelValue(frontmatter, "reviewStatus");
  if (
    reviewStatus !== null &&
    !ALLOWED_REVIEW_STATUSES.has(reviewStatus)
  ) {
    errors.push(
      "reviewStatus must be none, info, action-needed, assigned, or reviewed",
    );
  }

  const reviewArea = topLevelValue(frontmatter, "reviewArea");
  if (reviewArea !== null && reviewArea.length === 0) {
    errors.push("reviewArea is empty");
  }

  const findings = parseFindings(frontmatter);
  if (findings.length === 0) {
    errors.push("findings must contain at least one item");
  }

  for (const [index, finding] of findings.entries()) {
    for (const key of REQUIRED_FINDING_KEYS) {
      if (!finding[key]) errors.push(`findings[${index}] missing ${key}`);
    }

    if (finding.severity && !ALLOWED_SEVERITIES.has(finding.severity)) {
      errors.push(`findings[${index}] severity must be high, medium, or low`);
    }
  }

  const suggestedActions = parseObjectList(frontmatter, "suggestedActions");
  for (const [index, action] of suggestedActions.entries()) {
    if (!action.id) errors.push(`suggestedActions[${index}] missing id`);
    if (!action.type) errors.push(`suggestedActions[${index}] missing type`);
    if (!action.label) errors.push(`suggestedActions[${index}] missing label`);
    if (action.type && !ALLOWED_SUGGESTED_ACTION_TYPES.has(action.type)) {
      errors.push(
        `suggestedActions[${index}] type must be dispatch, create-task, or dismiss`,
      );
    }
    if (action.type === "dispatch") {
      if (!action.capability && !action.executable) {
        errors.push(
          `suggestedActions[${index}] dispatch requires capability`,
        );
      }
      if (!parsePositiveInteger(action.target)) {
        errors.push(`suggestedActions[${index}] dispatch requires target`);
      }
    }
    if (action.type === "create-task" && !action.title) {
      errors.push(`suggestedActions[${index}] create-task requires title`);
    }
  }

  return { file, ok: errors.length === 0, errors };
}

export function readReportFiles(reportsDir) {
  if (!existsSync(reportsDir)) {
    return { schemaExists: false, files: [], error: `${reportsDir} not found` };
  }

  const names = readdirSync(reportsDir).sort();
  return {
    schemaExists: names.includes("_schema.yaml"),
    files: names
      .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
      .map((name) => ({
        name,
        text: readFileSync(join(reportsDir, name), "utf8"),
      })),
  };
}

export function validateReportFiles(files) {
  return files.map((file) => validateReportText(file.name, file.text));
}

function runCli() {
  const reportsDir = process.argv[2] || "reports";
  const { schemaExists, files, error } = readReportFiles(reportsDir);
  const results = validateReportFiles(files);
  const failed = results.filter((result) => !result.ok);

  if (error) console.error(error);
  if (!schemaExists) console.error(`${reportsDir}/_schema.yaml not found`);

  for (const result of failed) {
    console.error(`${result.file}:`);
    for (const item of result.errors) console.error(`  - ${item}`);
  }

  if (error || !schemaExists || failed.length > 0) {
    process.exit(1);
  }

  console.log(`Validated ${files.length} report file(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
