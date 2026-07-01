import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createServer as createHttpServer,
  type Server as HttpServer,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doormanPath = resolve(repoRoot, "builder/doorman/doorman.ts");
const verifyKeyHex = "a".repeat(64);

const children: ChildProcessWithoutNullStreams[] = [];
const servers: HttpServer[] = [];

afterEach(async () => {
  await Promise.all([
    ...children.splice(0).map(stopChild),
    ...servers.splice(0).map(closeServer),
  ]);
});

function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
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
  const backend = createHttpServer((req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.end(`proxied ${req.url}`);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    backend.once("error", rejectListen);
    backend.listen(nextPort, "127.0.0.1", () => {
      backend.off("error", rejectListen);
      resolveListen();
    });
  });
  servers.push(backend);

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

function closeServer(server: HttpServer): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

describe("preview doorman", () => {
  it("accepts branch tickets for the configured branch and proxies without kp", async () => {
    const { port } = await startDoorman({
      KODY_REPO_CONTEXT: "owner/repo",
      KODY_BRANCH: "dev",
    });
    const ticket = mintTicket({ r: "owner/repo", b: "dev" });

    const res = await fetch(
      `http://127.0.0.1:${port}/lesson?tab=one&kp=${ticket}`,
      { redirect: "manual" },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("kody_preview_session=1");
    expect(res.headers.get("set-cookie")).toContain("Path=/");
    expect(res.headers.get("set-cookie")).toContain("Partitioned");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.text()).resolves.toBe("proxied /lesson?tab=one");
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

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Path=/");
    expect(res.headers.get("set-cookie")).toContain("Partitioned");
    await expect(res.text()).resolves.toBe("proxied /");
  });

  it("uses a root-scoped preview session for Next.js static chunks", async () => {
    const { port } = await startDoorman({
      KODY_REPO_CONTEXT: "owner/repo",
      KODY_PR: "42",
    });
    const ticket = mintTicket({ r: "owner/repo", p: 42 });

    const unauthChunkRes = await fetch(
      `http://127.0.0.1:${port}/_next/static/chunks/app/(frontend)/courses/%5BcourseSlug%5D/page.js`,
      { redirect: "manual" },
    );
    const authRes = await fetch(
      `http://127.0.0.1:${port}/courses/demo/chapters/one/lessons/two?kp=${ticket}`,
      { redirect: "manual" },
    );
    const sessionCookie = authRes.headers.get("set-cookie")?.split(";")[0];
    const authChunkRes = await fetch(
      `http://127.0.0.1:${port}/_next/static/chunks/app/(frontend)/courses/%5BcourseSlug%5D/page.js`,
      {
        headers: sessionCookie ? { cookie: sessionCookie } : {},
        redirect: "manual",
      },
    );
    const routeRes = await fetch(`http://127.0.0.1:${port}/lesson`, {
      redirect: "manual",
    });

    expect(unauthChunkRes.status).toBe(401);
    expect(authRes.status).toBe(200);
    expect(authRes.headers.get("set-cookie")).toContain("Path=/");
    expect(authChunkRes.status).toBe(200);
    await expect(authChunkRes.text()).resolves.toBe(
      "proxied /_next/static/chunks/app/(frontend)/courses/%5BcourseSlug%5D/page.js",
    );
    expect(routeRes.status).toBe(401);
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
    expect(builder).toContain("await installDoormanInContext(cwd)");
    expect(builder).toContain(
      'console.log("[builder] replacing repo doorman with bundled doorman")',
    );
    expect(builder).toContain(
      "await rm(target, { recursive: true, force: true })",
    );
    expect(builder).toContain("KODY_BRANCH");
    expect(lifecycle).toContain(
      '...("branch" in input ? { branch: input.branch } : {})',
    );
  });
});
