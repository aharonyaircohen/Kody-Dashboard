import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalSandbox,
  deleteLocalSandbox,
  getLocalSandbox,
  listLocalSandboxes,
  restoreLocalSandboxSnapshot,
  saveLocalSandboxSnapshot,
  sandboxScopeKey,
} from "@dashboard/lib/sandboxes/local-sandboxes";

const scope = { owner: "Acme Org", repo: "Kody Repo" };
const key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

let rootDir: string;
let oldMasterKey: string | undefined;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "kody-sandboxes-"));
  oldMasterKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = key;
});

afterEach(async () => {
  if (oldMasterKey === undefined) delete process.env.KODY_MASTER_KEY;
  else process.env.KODY_MASTER_KEY = oldMasterKey;
  await rm(rootDir, { recursive: true, force: true });
});

describe("local sandboxes", () => {
  it("creates repo-scoped home and workspace directories", async () => {
    const sandbox = await createLocalSandbox(
      scope,
      { name: "CLI auth test" },
      { rootDir, seedWorkspace: false },
    );

    expect(sandbox.scope).toBe(sandboxScopeKey(scope));
    expect(sandbox.name).toBe("CLI auth test");
    expect(sandbox.homeDir).toContain(sandbox.id);
    expect(sandbox.workspaceDir).toContain(sandbox.id);
    await expect(getLocalSandbox(scope, sandbox.id, { rootDir })).resolves.toMatchObject({
      id: sandbox.id,
      name: "CLI auth test",
    });
  });

  it("lists newest sandboxes first", async () => {
    const first = await createLocalSandbox(
      scope,
      { name: "First" },
      { rootDir, seedWorkspace: false },
    );
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
    const second = await createLocalSandbox(
      scope,
      { name: "Second" },
      { rootDir, seedWorkspace: false },
    );

    const sandboxes = await listLocalSandboxes(scope, { rootDir });

    expect(sandboxes.map((sandbox) => sandbox.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("seeds workspace when sandbox storage is inside the source workspace", async () => {
    const sourceWorkspace = await mkdtemp(join(tmpdir(), "kody-source-"));
    const nestedRoot = join(sourceWorkspace, ".kody", "sandboxes");
    await mkdir(join(sourceWorkspace, ".kody"), { recursive: true });
    await writeFile(join(sourceWorkspace, "README.md"), "source files");
    await writeFile(join(sourceWorkspace, ".kody", "local.txt"), "skip me");

    const sandbox = await createLocalSandbox(
      scope,
      { name: "Nested seed" },
      { rootDir: nestedRoot, sourceWorkspace },
    );

    await expect(
      readFile(join(sandbox.workspaceDir, "README.md"), "utf8"),
    ).resolves.toBe("source files");
    await expect(
      readFile(join(sandbox.workspaceDir, ".kody", "local.txt"), "utf8"),
    ).rejects.toThrow();

    await rm(sourceWorkspace, { recursive: true, force: true });
  });

  it("creates a new sandbox from an existing sandbox with settings", async () => {
    const source = await createLocalSandbox(
      scope,
      { name: "Logged in" },
      { rootDir, seedWorkspace: false },
    );
    await writeFile(join(source.homeDir, ".zsh_history"), "codex login\n");
    await writeFile(join(source.workspaceDir, "settings.json"), "{\"ok\":true}");

    const copy = await createLocalSandbox(
      scope,
      { name: "Copied", sourceSandboxId: source.id },
      { rootDir },
    );

    await expect(readFile(join(copy.homeDir, ".zsh_history"), "utf8")).resolves.toBe(
      "codex login\n",
    );
    await expect(
      readFile(join(copy.workspaceDir, "settings.json"), "utf8"),
    ).resolves.toBe("{\"ok\":true}");
  });

  it("deletes a sandbox directory and removes it from the list", async () => {
    const sandbox = await createLocalSandbox(
      scope,
      { name: "Delete me" },
      { rootDir, seedWorkspace: false },
    );

    await expect(deleteLocalSandbox(scope, sandbox.id, { rootDir })).resolves.toBe(
      true,
    );

    await expect(getLocalSandbox(scope, sandbox.id, { rootDir })).resolves.toBeNull();
    await expect(listLocalSandboxes(scope, { rootDir })).resolves.toEqual([]);
  });

  it("saves and restores home and workspace data", async () => {
    const sandbox = await createLocalSandbox(
      scope,
      { name: "Saved auth" },
      { rootDir, seedWorkspace: false },
    );
    await writeFile(join(sandbox.homeDir, ".zsh_history"), "gh auth login\n");
    await writeFile(join(sandbox.workspaceDir, "note.txt"), "workspace state");

    await saveLocalSandboxSnapshot(scope, sandbox.id, { rootDir });
    await writeFile(join(sandbox.homeDir, ".zsh_history"), "changed\n");
    await writeFile(join(sandbox.workspaceDir, "note.txt"), "changed");
    await restoreLocalSandboxSnapshot(scope, sandbox.id, { rootDir });

    await expect(readFile(join(sandbox.homeDir, ".zsh_history"), "utf8")).resolves.toBe(
      "gh auth login\n",
    );
    await expect(readFile(join(sandbox.workspaceDir, "note.txt"), "utf8")).resolves.toBe(
      "workspace state",
    );
  });
});
