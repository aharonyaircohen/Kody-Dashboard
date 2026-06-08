#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_REPORT_KEYS = ["generatedAt", "findings"];
const REQUIRED_FINDING_KEYS = ["id", "severity", "title"];
const ALLOWED_SEVERITIES = new Set(["high", "medium", "low"]);

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
  const lines = frontmatter.split("\n");
  const findingsStart = lines.findIndex((line) => /^findings:\s*$/.test(line));
  if (findingsStart < 0) return [];

  const findings = [];
  let current = null;

  for (const line of lines.slice(findingsStart + 1)) {
    if (/^\S/.test(line)) break;

    const firstKey = line.match(/^\s{2}-\s+([A-Za-z][\w-]*):\s*(.*)$/);
    if (firstKey) {
      current = { [firstKey[1]]: unquote(firstKey[2]) };
      findings.push(current);
      continue;
    }

    const nextKey = line.match(/^\s{4}([A-Za-z][\w-]*):\s*(.*)$/);
    if (current && nextKey) {
      current[nextKey[1]] = unquote(nextKey[2]);
    }
  }

  return findings;
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

  const dutySlug = topLevelValue(frontmatter, "dutySlug");
  if (dutySlug !== null && dutySlug.length === 0) {
    errors.push("dutySlug is empty");
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
  const reportsDir = process.argv[2] || ".kody/reports";
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
