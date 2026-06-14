/**
 * @fileType utility
 * @domain sandboxes
 * @pattern local-sandbox-store
 *
 * Local dev sandbox profiles. A sandbox is a repo-scoped HOME plus workspace
 * directory that can be started by the chat terminal and archived for later.
 */
import { spawn } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";

export interface SandboxScope {
  owner: string;
  repo: string;
}

export type SandboxRuntime = "local" | "github-actions";

export interface LocalSandbox {
  id: string;
  name: string;
  runtime: SandboxRuntime;
  scope: string;
  rootDir: string;
  homeDir: string;
  workspaceDir: string;
  snapshotPath: string;
  createdAt: string;
  updatedAt: string;
  snapshotUpdatedAt?: string;
}

interface SandboxMetadata {
  version: 1;
  id: string;
  name: string;
  runtime?: SandboxRuntime;
  scope: string;
  createdAt: string;
  updatedAt: string;
  snapshotUpdatedAt?: string;
}

interface StoreOptions {
  rootDir?: string;
  sourceWorkspace?: string;
  seedWorkspace?: boolean;
}

function isSandboxRuntime(value: unknown): value is SandboxRuntime {
  return value === "local" || value === "github-actions";
}

const METADATA_FILE = "sandbox.json";
const SNAPSHOT_FILE = "snapshot.tar.gz.enc";
const ID_RE = /^sandbox-[0-9a-f-]{36}$/i;
const SNAPSHOT_HEADER = "kody-sandbox-snapshot-v1";
const WORKSPACE_SKIP = new Set([
  ".git",
  ".next",
  ".vercel",
  "coverage",
  ".kody",
  "node_modules",
  "test-results",
]);

function defaultRootDir(): string {
  return resolve(process.cwd(), ".kody", "sandboxes");
}

export function sandboxScopeKey(scope: SandboxScope): string {
  const raw = `${scope.owner}/${scope.repo}`.toLowerCase();
  const safe = raw.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "unknown-repo";
}

function rootForScope(scope: SandboxScope, options: StoreOptions = {}): string {
  return join(
    resolve(options.rootDir ?? defaultRootDir()),
    sandboxScopeKey(scope),
  );
}

function metadataPath(rootDir: string): string {
  return join(rootDir, METADATA_FILE);
}

function assertSandboxId(id: string): void {
  if (!ID_RE.test(id)) throw new Error("Invalid sandbox id");
}

function assertInside(parent: string, child: string): void {
  const rel = relative(resolve(parent), resolve(child));
  if (rel.startsWith("..") || rel === "" || resolve(rel) === rel) {
    throw new Error("Sandbox path escaped root");
  }
}

function cleanName(value: string | undefined): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return name || "New sandbox";
}

async function readMetadata(rootDir: string): Promise<SandboxMetadata | null> {
  try {
    const parsed = JSON.parse(
      await readFile(metadataPath(rootDir), "utf8"),
    ) as {
      version?: unknown;
      id?: unknown;
      name?: unknown;
      runtime?: unknown;
      scope?: unknown;
      createdAt?: unknown;
      updatedAt?: unknown;
      snapshotUpdatedAt?: unknown;
    };
    if (
      parsed.version !== 1 ||
      typeof parsed.id !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.scope !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      id: parsed.id,
      name: parsed.name,
      runtime: isSandboxRuntime(parsed.runtime) ? parsed.runtime : "local",
      scope: parsed.scope,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
      ...(typeof parsed.snapshotUpdatedAt === "string"
        ? { snapshotUpdatedAt: parsed.snapshotUpdatedAt }
        : {}),
    };
  } catch {
    return null;
  }
}

function toSandbox(rootDir: string, metadata: SandboxMetadata): LocalSandbox {
  return {
    id: metadata.id,
    name: metadata.name,
    runtime: metadata.runtime ?? "local",
    scope: metadata.scope,
    rootDir,
    homeDir: join(rootDir, "home"),
    workspaceDir: join(rootDir, "workspace"),
    snapshotPath: join(rootDir, SNAPSHOT_FILE),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...(metadata.snapshotUpdatedAt
      ? { snapshotUpdatedAt: metadata.snapshotUpdatedAt }
      : {}),
  };
}

async function writeMetadata(sandbox: LocalSandbox): Promise<void> {
  const metadata: SandboxMetadata = {
    version: 1,
    id: sandbox.id,
    name: sandbox.name,
    runtime: sandbox.runtime,
    scope: sandbox.scope,
    createdAt: sandbox.createdAt,
    updatedAt: sandbox.updatedAt,
    ...(sandbox.snapshotUpdatedAt
      ? { snapshotUpdatedAt: sandbox.snapshotUpdatedAt }
      : {}),
  };
  await writeFile(
    metadataPath(sandbox.rootDir),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

async function seedWorkspace(
  targetDir: string,
  sourceDir: string,
): Promise<void> {
  const sourceRoot = resolve(sourceDir);
  const targetRoot = resolve(targetDir);
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      if (WORKSPACE_SKIP.has(entry.name)) return;
      const source = join(sourceRoot, entry.name);
      const target = join(targetRoot, entry.name);
      await cp(source, target, {
        recursive: true,
        force: false,
        errorOnExist: false,
        filter(candidate) {
          const rel = relative(sourceRoot, candidate);
          return !rel.split(/[\\/]/).some((part) => WORKSPACE_SKIP.has(part));
        },
      });
    }),
  );
}

export async function listLocalSandboxes(
  scope: SandboxScope,
  options: StoreOptions = {},
): Promise<LocalSandbox[]> {
  const scopeRoot = rootForScope(scope, options);
  try {
    await mkdir(scopeRoot, { recursive: true });
    const entries = await readdir(scopeRoot, { withFileTypes: true });
    const sandboxes = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const rootDir = join(scopeRoot, entry.name);
          const metadata = await readMetadata(rootDir);
          return metadata ? toSandbox(rootDir, metadata) : null;
        }),
    );
    return sandboxes
      .filter((sandbox): sandbox is LocalSandbox => sandbox !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

export async function createLocalSandbox(
  scope: SandboxScope,
  input: {
    name?: string;
    runtime?: SandboxRuntime;
    sourceSandboxId?: string;
  } = {},
  options: StoreOptions = {},
): Promise<LocalSandbox> {
  const scopeRoot = rootForScope(scope, options);
  await mkdir(scopeRoot, { recursive: true });
  const id = `sandbox-${randomUUID()}`;
  const rootDir = join(scopeRoot, id);
  assertInside(scopeRoot, rootDir);
  const now = new Date().toISOString();
  const sandbox: LocalSandbox = {
    id,
    name: cleanName(input.name),
    runtime: input.runtime ?? "local",
    scope: sandboxScopeKey(scope),
    rootDir,
    homeDir: join(rootDir, "home"),
    workspaceDir: join(rootDir, "workspace"),
    snapshotPath: join(rootDir, SNAPSHOT_FILE),
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(sandbox.homeDir, { recursive: true });
  await mkdir(sandbox.workspaceDir, { recursive: true });
  try {
    if (input.sourceSandboxId) {
      const sourceSandbox = await getLocalSandbox(
        scope,
        input.sourceSandboxId,
        options,
      );
      if (!sourceSandbox) throw new Error("Source sandbox not found");
      await cp(sourceSandbox.homeDir, sandbox.homeDir, {
        recursive: true,
        force: true,
      });
      await cp(sourceSandbox.workspaceDir, sandbox.workspaceDir, {
        recursive: true,
        force: true,
      });
    } else if (options.seedWorkspace !== false) {
      await seedWorkspace(
        sandbox.workspaceDir,
        options.sourceWorkspace ?? process.cwd(),
      );
    }
    await writeMetadata(sandbox);
  } catch (err) {
    await rm(rootDir, { recursive: true, force: true });
    throw err;
  }
  return sandbox;
}

export async function getLocalSandbox(
  scope: SandboxScope,
  id: string,
  options: StoreOptions = {},
): Promise<LocalSandbox | null> {
  assertSandboxId(id);
  const scopeRoot = rootForScope(scope, options);
  const rootDir = join(scopeRoot, id);
  assertInside(scopeRoot, rootDir);
  const metadata = await readMetadata(rootDir);
  return metadata ? toSandbox(rootDir, metadata) : null;
}

export async function deleteLocalSandbox(
  scope: SandboxScope,
  id: string,
  options: StoreOptions = {},
): Promise<boolean> {
  assertSandboxId(id);
  const scopeRoot = rootForScope(scope, options);
  const rootDir = join(scopeRoot, id);
  assertInside(scopeRoot, rootDir);
  const existing = await readMetadata(rootDir);
  if (!existing) return false;
  await rm(rootDir, { recursive: true, force: true });
  return true;
}

function normalizeSnapshotKey(): Buffer {
  const raw = process.env.KODY_MASTER_KEY;
  if (!raw) {
    throw new Error("KODY_MASTER_KEY is required to save sandbox snapshots");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("KODY_MASTER_KEY must decode to 32 bytes");
  }
  return key;
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited ${code}`));
    });
  });
}

async function encryptFile(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const key = normalizeSnapshotKey();
  const iv = randomBytes(12);
  const plaintext = await readFile(inputPath);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = `${SNAPSHOT_HEADER}:${iv.toString("base64")}:${tag.toString(
    "base64",
  )}\n`;
  await writeFile(outputPath, Buffer.concat([Buffer.from(header), ciphertext]));
}

async function decryptFile(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const key = normalizeSnapshotKey();
  const payload = await readFile(inputPath);
  const newline = payload.indexOf(10);
  if (newline === -1) throw new Error("Snapshot header missing");
  const header = payload.subarray(0, newline).toString("utf8");
  const [version, ivB64, tagB64] = header.split(":");
  if (version !== SNAPSHOT_HEADER || !ivB64 || !tagB64) {
    throw new Error("Snapshot header invalid");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(payload.subarray(newline + 1)),
    decipher.final(),
  ]);
  await writeFile(outputPath, plaintext);
}

export async function saveLocalSandboxSnapshot(
  scope: SandboxScope,
  id: string,
  options: StoreOptions = {},
): Promise<LocalSandbox> {
  const sandbox = await getLocalSandbox(scope, id, options);
  if (!sandbox) throw new Error("Sandbox not found");
  sandbox.snapshotUpdatedAt = new Date().toISOString();
  sandbox.updatedAt = sandbox.snapshotUpdatedAt;
  await writeMetadata(sandbox);
  const tmpArchive = join(sandbox.rootDir, "snapshot.tmp.tar.gz");
  await rm(tmpArchive, { force: true });
  await runCommand("tar", [
    "-czf",
    tmpArchive,
    "-C",
    sandbox.rootDir,
    "home",
    "workspace",
    METADATA_FILE,
  ]);
  try {
    await encryptFile(tmpArchive, sandbox.snapshotPath);
  } finally {
    await rm(tmpArchive, { force: true });
  }
  return sandbox;
}

export async function restoreLocalSandboxSnapshot(
  scope: SandboxScope,
  id: string,
  options: StoreOptions = {},
): Promise<LocalSandbox> {
  const sandbox = await getLocalSandbox(scope, id, options);
  if (!sandbox) throw new Error("Sandbox not found");
  if (!existsSync(sandbox.snapshotPath)) throw new Error("Snapshot not found");
  const tmpArchive = join(sandbox.rootDir, "snapshot.restore.tar.gz");
  await decryptFile(sandbox.snapshotPath, tmpArchive);
  try {
    await rm(sandbox.homeDir, { recursive: true, force: true });
    await rm(sandbox.workspaceDir, { recursive: true, force: true });
    await runCommand("tar", ["-xzf", tmpArchive, "-C", sandbox.rootDir]);
  } finally {
    await rm(tmpArchive, { force: true });
  }
  const restored = await getLocalSandbox(scope, id, options);
  if (!restored) throw new Error("Snapshot restore failed");
  await mkdir(restored.homeDir, { recursive: true });
  await mkdir(restored.workspaceDir, { recursive: true });
  return restored;
}

export async function assertSandboxReady(sandbox: LocalSandbox): Promise<void> {
  const home = await stat(sandbox.homeDir);
  const workspace = await stat(sandbox.workspaceDir);
  if (!home.isDirectory() || !workspace.isDirectory()) {
    throw new Error("Sandbox is missing home or workspace directory");
  }
}
