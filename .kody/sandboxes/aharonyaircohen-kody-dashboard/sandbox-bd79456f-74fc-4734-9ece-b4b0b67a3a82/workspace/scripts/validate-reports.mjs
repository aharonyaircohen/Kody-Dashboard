#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  readReportFiles,
  validateReportFiles,
} from "./report-schema-validator.mjs";

export function validateReportsDir(reportsDir) {
  const { schemaExists, files, error } = readReportFiles(reportsDir);
  const results = validateReportFiles(files);
  const failed = results.filter((result) => !result.ok);

  return {
    ok: !error && schemaExists && failed.length === 0,
    error,
    schemaExists,
    files,
    failed,
  };
}

function runCli() {
  const reportsDir = process.argv[2] || ".kody/reports";
  const result = validateReportsDir(reportsDir);

  if (result.error) console.error(result.error);
  if (!result.schemaExists)
    console.error(`${reportsDir}/_schema.yaml not found`);

  for (const failed of result.failed) {
    console.error(`${failed.file}:`);
    for (const item of failed.errors) console.error(`  - ${item}`);
  }

  if (!result.ok) process.exit(1);

  console.log(`Validated ${result.files.length} report file(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
