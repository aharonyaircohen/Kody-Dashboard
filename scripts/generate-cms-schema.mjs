#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rawArgs = process.argv.slice(2);
const adapter = readAdapter(rawArgs);

if (!adapter || rawArgs.includes("--help")) {
  printUsage();
  process.exit(rawArgs.includes("--help") ? 0 : 1);
}

const adapterCommands = new Map([
  [
    "mongodb",
    path.join(dirname, "cms-adapters", "mongodb", "generate-schema.mjs"),
  ],
]);

const command = adapterCommands.get(adapter);
if (!command) {
  console.error(`Unknown CMS schema adapter: ${adapter}`);
  process.exit(1);
}

const childArgs = rawArgs.filter((arg, index) => {
  if (arg === "--adapter") return false;
  if (rawArgs[index - 1] === "--adapter") return false;
  return true;
});

const result = spawnSync(process.execPath, [command, ...childArgs], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);

function readAdapter(args) {
  const index = args.indexOf("--adapter");
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function printUsage() {
  console.log(`Usage:
  pnpm cms:generate-schema -- --adapter mongodb --state-root /path/to/kody-state --repo my-repo --env-file /path/to/.env
`);
}
