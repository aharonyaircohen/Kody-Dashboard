import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureTerminalBridge,
  findTerminalBridge,
  TERMINAL_BRIDGE_SCRIPT,
  TERMINAL_BRIDGE_PTY_RELAY_SCRIPT,
  TERMINAL_BRIDGE_BASE_IMAGE,
  TERMINAL_BRIDGE_VERSION,
  terminalBridgeAppName,
} from "@dashboard/lib/infrastructure/plugins/fly/terminal/bridge";
import type { FlyPreviewConfig } from "@dashboard/lib/infrastructure/plugins/fly/previews/machines-client";

const CFG: FlyPreviewConfig = {
  token: "fly-test-token",
  orgSlug: "personal",
  defaultRegion: "fra",
};

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

function installFetchStub(
  handler: (call: RecordedCall) => { status?: number; json?: unknown },
): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body =
        typeof init?.body === "string" && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        for (const key of Object.keys(h)) headers[key.toLowerCase()] = h[key]!;
      }
      const call = { url, method, body, headers };
      calls.push(call);

      if (call.method === "GET" && /\/apps\/[^/]+\/ips$/.test(call.url)) {
        return new Response(JSON.stringify([{ id: "ip-1" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (call.url === "https://api.fly.io/graphql") {
        return new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        call.url.startsWith("https://kody-terminal-") &&
        call.url.endsWith("/healthz")
      ) {
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }

      const response = handler(call);
      return new Response(
        response.json === undefined ? null : JSON.stringify(response.json),
        {
          status: response.status ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    }),
  );
  return calls;
}

async function waitForOutput(
  getOutput: () => string,
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const started = Date.now();
  while (!getOutput().includes(expected)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${expected}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("terminalBridgeAppName", () => {
  it("is deterministic and Fly-name-safe", () => {
    const app = terminalBridgeAppName(CFG);
    expect(app).toMatch(/^kody-terminal-personal-[a-f0-9]{12}$/);
    expect(terminalBridgeAppName(CFG)).toBe(app);
  });
});

describe("ensureTerminalBridge", () => {
  it("ships a persistent real-PTY SSH session", () => {
    const consoleSession = TERMINAL_BRIDGE_SCRIPT.match(
      /function createFlyConsoleSession[\s\S]*?\n}\n\nfunction attachSocketToSession/,
    )?.[0];

    expect(consoleSession).toBeTruthy();
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"flyctl"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"ssh"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"console"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("claims.orgSlug");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"--org"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("function flyctlOrgArgs");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('orgSlug !== "personal"');
    expect(consoleSession).toContain("FLY_API_TOKEN: claims.flyToken");
    expect(consoleSession).toContain("FLY_ACCESS_TOKEN: claims.flyToken");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("--pty");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("function repoShellCommand");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("claims.repoToken");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("repoTokenHash");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('url.pathname === "/exec"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('url.pathname === "/jobs"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      'url.pathname.startsWith("/jobs/")',
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("execJobs");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("startExecJob");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "const MAX_SSH_START_ATTEMPTS = 3;",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "const READY_PROBE_INTERVAL_MS = 2500;",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("readyProbeTimer");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "const SSH_START_RETRY_DELAY_MS = 2000;",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("isRetryableFlySshStartupFailure");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("tunnel unavailable");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("error contacting fly.io api");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("Retrying terminal tunnel");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "const MAX_EXEC_TIMEOUT_MS = 2 * 60 * 60 * 1000;",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      "const MAX_EXEC_TIMEOUT_MS = 15 * 60 * 1000;",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("--command");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("python3");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("pty-relay.py");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("persistentSessions");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("chatSessionId");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("activityLimitMs");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "session.activityLimitMs !== null",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('url.pathname === "/status"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("function ensureTmuxSession");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("function configureTmuxSession");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"set-option"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"status"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"off"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"mouse"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('["mouse", "off"]');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("stripTerminalMouseInput");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"history-limit"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("TERMINAL_TMUX_HISTORY_LIMIT");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("function tmuxPaneCommand");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('"attach-session"');
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      "Reattached terminal session.",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("RESTORE_PROBE_TIMEOUT_MS");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("startRestoreProbe");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      "Terminal did not answer the restore check.",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "Terminal did not answer the keyboard self-test.",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain('type: "ready"');
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("findReadyProof");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("\\/dev\\/(?:pts\\/[0-9]+|tty");
    expect(consoleSession).not.toContain("--command");
    expect(consoleSession).not.toContain("script");
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      "Terminal opened, but it did not report a real TTY.",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain("SSH shell did not answer");
  });

  it("does not pass the Fly pseudo-org personal to flyctl ssh", () => {
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      'return orgSlug && orgSlug !== "personal" ? ["--org", orgSlug] : [];',
    );
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "...flyctlOrgArgs(claims.orgSlug)",
    );
    expect(TERMINAL_BRIDGE_SCRIPT).not.toContain(
      '...(claims.orgSlug ? ["--org", claims.orgSlug] : [])',
    );
  });

  it("keeps the local Fly wrapper from echoing browser input", () => {
    expect(TERMINAL_BRIDGE_PTY_RELAY_SCRIPT).toContain("def disable_echo(fd):");
    expect(TERMINAL_BRIDGE_PTY_RELAY_SCRIPT).toContain("termios.ECHO");
    expect(TERMINAL_BRIDGE_PTY_RELAY_SCRIPT).toContain(
      "disable_echo(slave_control_fd)",
    );
    expect(
      TERMINAL_BRIDGE_PTY_RELAY_SCRIPT.indexOf(
        "disable_echo(slave_control_fd)",
      ),
    ).toBeLessThan(
      TERMINAL_BRIDGE_PTY_RELAY_SCRIPT.indexOf("os.write(master, data)"),
    );
  });

  it("reattaches the browser to the tmux pane with typed restore lifecycle messages", () => {
    const attachSession = TERMINAL_BRIDGE_SCRIPT.match(
      /function attachSocketToSession[\s\S]*?\n}\n\nfunction startFlyConsole/,
    )?.[0];

    expect(attachSession).toBeTruthy();
    expect(TERMINAL_BRIDGE_SCRIPT).toContain(
      "const MAX_REPLAY_CHARS = 120000;",
    );
    expect(attachSession).toContain("restoreStartMessage(session.outputBuffer || \"\")");
    expect(attachSession).toContain("restoreCompleteMessage()");
    expect(attachSession).not.toContain("session.pendingOutput");
    expect(attachSession).not.toContain("Reattached terminal session.");
    expect(attachSession).toContain("session.restartChild()");
    expect(TERMINAL_BRIDGE_SCRIPT).toContain("session.sockets.size > 0");
    expect(attachSession).not.toContain("startRestoreProbe");
    expect(attachSession).not.toContain('type: "restoring"');
    expect(attachSession).not.toContain('type: "restore-failed"');
    expect(attachSession).toContain('type: "ready"');
  });

  it("binds browser input before sending attach readiness", () => {
    const attachSession = TERMINAL_BRIDGE_SCRIPT.match(
      /function attachSocketToSession[\s\S]*?\n}\n\nfunction startFlyConsole/,
    )?.[0];

    expect(attachSession).toBeTruthy();
    expect(attachSession!.indexOf("parseFrames(socket")).toBeGreaterThan(-1);
    expect(attachSession!.indexOf("parseFrames(socket")).toBeLessThan(
      attachSession!.indexOf('sendJson(socket, { type: "ready" });'),
    );
  });

  it("acknowledges accepted terminal input and rejects unwritable stdin", () => {
    const attachSession = TERMINAL_BRIDGE_SCRIPT.match(
      /function attachSocketToSession[\s\S]*?\n}\n\nfunction startFlyConsole/,
    )?.[0];

    expect(attachSession).toBeTruthy();
    expect(attachSession).toContain('type: "input-accepted"');
    expect(attachSession).toContain('type: "input-rejected"');
    expect(attachSession).toContain("msg.id");
    expect(attachSession).toContain("session.child.stdin.write");
    expect(attachSession).not.toContain(
      "if (!session.child.stdin.destroyed) {\n        session.child.stdin.write(msg.data);",
    );
  });

  it("does not mirror typed input when the wrapped process enables PTY echo", async () => {
    if (process.env.CI) {
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "kody-pty-relay-"));
    const relayPath = join(dir, "relay.py");
    const childPath = join(dir, "child.py");
    writeFileSync(relayPath, TERMINAL_BRIDGE_PTY_RELAY_SCRIPT);
    writeFileSync(
      childPath,
      String.raw`#!/usr/bin/env python3
import os
import sys
import termios

fd = sys.stdin.fileno()
attrs = termios.tcgetattr(fd)
attrs[3] = attrs[3] | termios.ECHO
termios.tcsetattr(fd, termios.TCSANOW, attrs)
data = os.read(fd, 1024)
os.write(sys.stdout.fileno(), b"REMOTE:" + data)
`,
    );

    try {
      const child = spawn("python3", [relayPath, "python3", childPath], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const closePromise = new Promise<number | null>((resolve) => {
        child.on("close", resolve);
      });

      child.stdin.write("abc\n");
      await waitForOutput(() => stdout, "REMOTE:abc");
      child.stdin.end();
      const code = await closePromise;

      expect(stderr).toBe("");
      expect(code).toBe(0);
      expect(stdout).toContain("REMOTE:abc");
      expect(stdout).not.toContain("abc\r\nREMOTE:");
      expect(stdout).not.toContain("abc\nREMOTE:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("ships syntactically valid bridge JavaScript", () => {
    const source = ts.createSourceFile(
      "bridge.mjs",
      TERMINAL_BRIDGE_SCRIPT,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };

    expect(source.parseDiagnostics).toHaveLength(0);
  });

  it("boots flyctl with WireGuard over WebSockets enabled", async () => {
    const app = terminalBridgeAppName(CFG);
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { status: 404 };
      }
      if (call.method === "POST" && call.url.endsWith("/apps")) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        return { status: 404 };
      }
      if (
        call.method === "POST" &&
        call.url.endsWith(`/apps/${app}/machines`)
      ) {
        return { json: { id: "bridge-1", state: "started", region: "fra" } };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    await ensureTerminalBridge(CFG);

    const createMachine = calls.find(
      (call) =>
        call.method === "POST" && call.url.endsWith(`/apps/${app}/machines`),
    )!;
    const startFile = (
      createMachine.body as {
        config: { files: Array<{ guest_path: string; raw_value: string }> };
      }
    ).config.files.find((file) => file.guest_path === "/app/start.sh")!;
    const startScript = Buffer.from(startFile.raw_value, "base64").toString(
      "utf8",
    );
    expect(startScript).toContain("wire_guard_websockets: true");
  });

  it("creates the bridge app and machine when missing", async () => {
    const app = terminalBridgeAppName(CFG);
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { status: 404 };
      }
      if (call.method === "POST" && call.url.endsWith("/apps")) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        return { status: 404 };
      }
      if (
        call.method === "POST" &&
        call.url.endsWith(`/apps/${app}/machines`)
      ) {
        return { json: { id: "bridge-1", state: "started", region: "fra" } };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await ensureTerminalBridge(CFG);

    expect(out.app).toBe(app);
    expect(out.url).toBe(`https://${app}.fly.dev`);
    expect(out.machineId).toBe("bridge-1");
    expect(out.secret).toMatch(/^[a-f0-9]{64}$/);

    const createApp = calls.find(
      (call) => call.method === "POST" && call.url.endsWith("/apps"),
    )!;
    expect(createApp.body).toEqual({ app_name: app, org_slug: "personal" });

    const createMachine = calls.find(
      (call) =>
        call.method === "POST" && call.url.endsWith(`/apps/${app}/machines`),
    )!;
    const config = (
      createMachine.body as {
        config: {
          image: string;
          env: Record<string, string>;
          files: unknown[];
          init: { exec: string[] };
        };
      }
    ).config;
    expect(config.image).toBe(TERMINAL_BRIDGE_BASE_IMAGE);
    expect(config.env.BRIDGE_AUTH_SECRET).toBe(out.secret);
    expect(config.env.KODY_TERMINAL_BRIDGE_VERSION).toBe(
      TERMINAL_BRIDGE_VERSION,
    );
    expect(config.env.FLY_API_TOKEN).toBeUndefined();
    expect(config.files).toHaveLength(3);
    expect(config.init.exec).toEqual(["sh", "/app/start.sh"]);
    expect(
      calls.some(
        (call) =>
          call.method === "GET" &&
          call.url === `https://${app}.fly.dev/healthz`,
      ),
    ).toBe(true);
  });

  it("reuses the bridge machine after a concurrent create conflict", async () => {
    const app = terminalBridgeAppName(CFG);
    let machineListCalls = 0;
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        machineListCalls += 1;
        return {
          json:
            machineListCalls === 1
              ? []
              : [
                  {
                    id: "bridge-winner",
                    state: "started",
                    region: "fra",
                    config: {
                      image: TERMINAL_BRIDGE_BASE_IMAGE,
                      env: {
                        BRIDGE_AUTH_SECRET: "winner-secret",
                        KODY_TERMINAL_BRIDGE_VERSION: TERMINAL_BRIDGE_VERSION,
                      },
                    },
                  },
                ],
        };
      }
      if (
        call.method === "POST" &&
        call.url.endsWith(`/apps/${app}/machines`)
      ) {
        return {
          status: 409,
          json: {
            error:
              'already_exists: unique machine name violation, machine ID bridge-winner already exists with name "terminal-fra"',
          },
        };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await ensureTerminalBridge(CFG);

    expect(out).toMatchObject({
      app,
      machineId: "bridge-winner",
      secret: "winner-secret",
      url: `https://${app}.fly.dev`,
    });
    expect(
      calls.filter(
        (call) =>
          call.method === "POST" && call.url.endsWith(`/apps/${app}/machines`),
      ),
    ).toHaveLength(1);
    expect(machineListCalls).toBe(2);
  });

  it("replaces a stale bridge machine after a Fly machine-name conflict", async () => {
    const app = terminalBridgeAppName(CFG);
    let machineListCalls = 0;
    let createCalls = 0;
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        machineListCalls += 1;
        return {
          json:
            machineListCalls <= 2
              ? [
                  {
                    id: "stale-bridge",
                    state: "started",
                    region: "fra",
                    config: {
                      image: TERMINAL_BRIDGE_BASE_IMAGE,
                      env: {
                        BRIDGE_AUTH_SECRET: "stale-secret",
                        KODY_TERMINAL_BRIDGE_VERSION: "old",
                      },
                    },
                  },
                ]
              : [],
        };
      }
      if (
        call.method === "DELETE" &&
        call.url.includes(`/apps/${app}/machines/stale-bridge`)
      ) {
        return { json: { ok: true } };
      }
      if (
        call.method === "POST" &&
        call.url.endsWith(`/apps/${app}/machines`)
      ) {
        createCalls += 1;
        if (createCalls === 1) {
          return {
            status: 409,
            json: {
              error:
                'already_exists: unique machine name violation, machine ID stale-bridge already exists with name "terminal-fra"',
            },
          };
        }
        return {
          json: { id: "fresh-bridge", state: "started", region: "fra" },
        };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await ensureTerminalBridge(CFG);

    expect(out).toMatchObject({
      app,
      machineId: "fresh-bridge",
      url: `https://${app}.fly.dev`,
    });
    expect(createCalls).toBe(2);
    expect(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          call.url.includes(`/apps/${app}/machines/stale-bridge`),
      ),
    ).toHaveLength(2);
  });

  it("reuses an existing current bridge machine", async () => {
    const app = terminalBridgeAppName(CFG);
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        return {
          json: [
            {
              id: "bridge-existing",
              state: "started",
              region: "fra",
              config: {
                image: `${TERMINAL_BRIDGE_BASE_IMAGE}@sha256:abc`,
                env: {
                  BRIDGE_AUTH_SECRET: "existing-secret",
                  KODY_TERMINAL_BRIDGE_VERSION: TERMINAL_BRIDGE_VERSION,
                },
              },
            },
          ],
        };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await ensureTerminalBridge(CFG);

    expect(out.machineId).toBe("bridge-existing");
    expect(out.secret).toBe("existing-secret");
    expect(
      calls.some(
        (call) =>
          call.method === "POST" && call.url.endsWith(`/apps/${app}/machines`),
      ),
    ).toBe(false);
    expect(
      calls.some(
        (call) =>
          call.method === "GET" && call.url.endsWith(`/apps/${app}/ips`),
      ),
    ).toBe(false);
  });

  it("finds an existing current bridge without creating one", async () => {
    const app = terminalBridgeAppName(CFG);
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        return {
          json: [
            {
              id: "bridge-existing",
              state: "started",
              region: "fra",
              config: {
                image: `${TERMINAL_BRIDGE_BASE_IMAGE}@sha256:abc`,
                env: {
                  BRIDGE_AUTH_SECRET: "existing-secret",
                  KODY_TERMINAL_BRIDGE_VERSION: TERMINAL_BRIDGE_VERSION,
                },
              },
            },
          ],
        };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await findTerminalBridge(CFG);

    expect(out).toMatchObject({
      app,
      machineId: "bridge-existing",
      secret: "existing-secret",
      url: `https://${app}.fly.dev`,
    });
    expect(
      calls.some(
        (call) =>
          call.method === "POST" && call.url.endsWith(`/apps/${app}/machines`),
      ),
    ).toBe(false);
  });

  it("replaces a stale bridge machine", async () => {
    const app = terminalBridgeAppName(CFG);
    const calls = installFetchStub((call) => {
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}`)) {
        return { json: { name: app } };
      }
      if (call.method === "GET" && call.url.endsWith(`/apps/${app}/machines`)) {
        return {
          json: [
            {
              id: "old-bridge",
              state: "started",
              region: "fra",
              config: {
                image: TERMINAL_BRIDGE_BASE_IMAGE,
                env: {
                  BRIDGE_AUTH_SECRET: "old-secret",
                  KODY_TERMINAL_BRIDGE_VERSION: "old",
                },
              },
            },
          ],
        };
      }
      if (
        call.method === "DELETE" &&
        call.url.includes(`/apps/${app}/machines/old-bridge`)
      ) {
        return { json: { ok: true } };
      }
      if (
        call.method === "POST" &&
        call.url.endsWith(`/apps/${app}/machines`)
      ) {
        return { json: { id: "new-bridge", state: "started", region: "fra" } };
      }
      throw new Error(`unexpected call: ${call.method} ${call.url}`);
    });

    const out = await ensureTerminalBridge(CFG);

    expect(out.machineId).toBe("new-bridge");
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});
