import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doormanPath = resolve(repoRoot, "builder/doorman/doorman.ts");
const verifyKeyHex = "a".repeat(64);

const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
});

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate port")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function mintTicket(
  identity: { r: string; p: number } | { r: string; b: string },
): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const subject =
    "p" in identity
      ? `${identity.r}#${identity.p}:${exp}`
      : `${identity.r}@${identity.b}:${exp}`;
  const s = createHmac("sha256", Buffer.from(verifyKeyHex, "hex"))
    .update(subject)
    .digest("hex")
    .slice(0, 32);

  return Buffer.from(JSON.stringify({ ...identity, e: exp, s })).toString(
    "base64url",
  );
}

async function startDoorman(
  env: Record<string, string>,
): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const [port, nextPort] = await Promise.all([getFreePort(), getFreePort()]);
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", doormanPath],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
        NEXT_INTERNAL_PORT: String(nextPort),
        KODY_PREVIEW_VERIFY_KEY: verifyKeyHex,
        ...env,
      },
    },
  );
  child.stdin.end();
  children.push(child);

  await new Promise<void>((resolveReady, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`doorman did not start: ${stderr}`));
    }, 5000);

    child.stdout.on("data", (chunk: Buffer) => {
      if (chunk.toString("utf8").includes("listening")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`doorman exited early with code ${code}: ${stderr}`));
    });
  });

  return { child, port };
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveStop) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolveStop();
      return;
    }

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolveStop();
    }, 1000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill("SIGTERM");
  });
}

describe("preview doorman", () => {
  it("accepts branch tickets for the configured branch and strips kp", async () => {
    const { port } = await startDoorman({
      KODY_REPO_CONTEXT: "owner/repo",
      KODY_BRANCH: "dev",
    });
    const ticket = mintTicket({ r: "owner/repo", b: "dev" });

    const res = await fetch(
      `http://127.0.0.1:${port}/lesson?tab=one&kp=${ticket}`,
      { redirect: "manual" },
    );

    expect(res.status).toBe(302);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("kody_preview_session=1");
    expect(cookie).toContain("SameSite=None");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Partitioned");
    expect(res.headers.get("location")).toBe("/lesson?tab=one");
  });

  it("rejects branch tickets minted for another branch", async () => {
    const { port } = await startDoorman({
      KODY_REPO_CONTEXT: "owner/repo",
      KODY_BRANCH: "dev",
    });
    const ticket = mintTicket({ r: "owner/repo", b: "main" });

    const res = await fetch(`http://127.0.0.1:${port}/?kp=${ticket}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(401);
  });

  it("accepts PR tickets for the configured PR", async () => {
    const { port } = await startDoorman({
      KODY_REPO_CONTEXT: "owner/repo",
      KODY_PR: "42",
    });
    const ticket = mintTicket({ r: "owner/repo", p: 42 });

    const res = await fetch(`http://127.0.0.1:${port}/?kp=${ticket}`, {
      redirect: "manual",
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });
});

describe("preview builder doorman wiring", () => {
  it("ships and injects doorman before building custom preview Dockerfiles", () => {
    const dockerfile = readFileSync(
      resolve(repoRoot, "builder/Dockerfile"),
      "utf8",
    );
    const builder = readFileSync(
      resolve(repoRoot, "builder/src/builder.ts"),
      "utf8",
    );
    const lifecycle = readFileSync(
      resolve(repoRoot, "src/dashboard/lib/previews/preview-lifecycle.ts"),
      "utf8",
    );

    expect(dockerfile).toContain("COPY doorman ./doorman");
    expect(builder).toContain('const source = "/app/doorman"');
    expect(builder).toContain("await ensureDoormanInContext(cwd)");
    expect(builder).toContain("KODY_BRANCH");
    expect(lifecycle).toContain(
      '...("branch" in input ? { branch: input.branch } : {})',
    );
  });
});
