/**
 * @fileoverview Runtime regression coverage for the embedded Fly terminal bridge.
 * @testFramework vitest
 * @domain terminal
 */
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { TERMINAL_BRIDGE_SCRIPT } from "@dashboard/lib/terminal/bridge-fly";
import { mintTerminalBridgeToken } from "@dashboard/lib/terminal/terminal-token";

const BRIDGE_SECRET = "runtime-bridge-secret";
const TEST_TIMEOUT_MS = 20_000;

let bridgeProcess: ChildProcess | null = null;
let tempDir: string | null = null;
let bridgeOutput = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to allocate port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

async function waitForHttpOk(url: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`bridge did not become healthy: ${lastError}`);
}

async function startBridge(): Promise<{ port: number; dir: string }> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "kody-terminal-bridge-"));
  const binDir = join(dir, "bin");
  tempDir = dir;
  writeFileSync(join(dir, "bridge.mjs"), TERMINAL_BRIDGE_SCRIPT);
  await import("node:fs/promises").then((fs) => fs.mkdir(binDir));
  writeExecutable(
    join(binDir, "python3"),
    `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const relayArgs = process.argv.slice(2);
const command = relayArgs[0] === "/app/pty-relay.py" ? relayArgs.slice(1) : relayArgs;
if (command.length === 0) process.exit(2);
const child = spawn(command[0], command.slice(1), {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});
try {
  const control = fs.createReadStream(null, { fd: 3, autoClose: false, encoding: "utf8" });
  let controlBuffer = "";
  control.on("error", () => {});
  control.on("data", (chunk) => {
    controlBuffer += String(chunk);
    let newline = controlBuffer.indexOf("\\n");
    while (newline !== -1) {
      const line = controlBuffer.slice(0, newline);
      controlBuffer = controlBuffer.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message?.type === "resize") {
          process.stdout.write("PTY_RESIZE:" + message.cols + "x" + message.rows + "\\r\\n");
        }
      } catch {}
      newline = controlBuffer.indexOf("\\n");
    }
  });
} catch {}
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  child.stdin.write(chunk);
});
process.stdin.on("end", () => {
  child.stdin.end();
});
child.stdin.on("error", (err) => {
  process.stderr.write("relay stdin error: " + err.message + "\\n");
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
`,
  );
  writeExecutable(
    join(binDir, "tmux"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const stateDir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
function sessionFile(name) {
  return path.join(stateDir, "tmux-" + name + ".json");
}
function sessionName() {
  const index = args.indexOf("-t") === -1 ? args.indexOf("-s") : args.indexOf("-t");
  return index === -1 ? "" : args[index + 1] || "";
}
function readState(name) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(name), "utf8"));
  } catch {
    return { marker: "", attachCount: 0, statusOff: false, mouseOn: false, historyLimit: "", exitsOnAttach: false };
  }
}
function writeState(name, state) {
  fs.writeFileSync(sessionFile(name), JSON.stringify(state));
}
if (args[0] === "has-session") {
  process.exit(fs.existsSync(sessionFile(sessionName())) ? 0 : 1);
}
if (args[0] === "kill-session") {
  fs.rmSync(sessionFile(sessionName()), { force: true });
  process.exit(0);
}
if (args[0] === "new-session") {
  const name = args[args.indexOf("-s") + 1];
  writeState(name, {
    marker: "",
    attachCount: 0,
    statusOff: false,
    mouseOn: false,
    historyLimit: "",
    exitsOnAttach: args.slice(args.indexOf("-s") + 2).join(" ").includes("--command"),
  });
  process.exit(0);
}
if (args[0] === "set-option") {
  const name = sessionName();
  const state = readState(name);
  if (args.includes("status") && args.includes("off")) {
    state.statusOff = true;
  }
  if (args.includes("mouse") && args.includes("on")) {
    state.mouseOn = true;
  } else if (args.includes("mouse")) {
    state.mouseOn = false;
  }
  const historyLimitIndex = args.indexOf("history-limit");
  if (historyLimitIndex !== -1) {
    state.historyLimit = args[historyLimitIndex + 1] || "";
  }
  writeState(name, state);
  process.exit(0);
}
if (args[0] === "attach-session") {
  const name = sessionName();
  const state = readState(name);
  state.attachCount += 1;
  writeState(name, state);
  if (state.exitsOnAttach) {
    process.stdout.write("[exited]\\r\\n");
    process.exit(0);
  }
  if (!state.statusOff) {
    process.stdout.write("[" + name.slice(0, 10) + ":flyctl]*\\r\\n");
  }
  if (state.mouseOn) {
    process.stdout.write("TMUX_MOUSE_CAPTURED\\r\\n");
  }
  if (Number(state.historyLimit) < 50000) {
    process.stdout.write("TMUX_SCROLL_DISABLED\\r\\n");
  }
  if (state.marker) {
    process.stdout.write("\\x1b[2J\\x1b[H" + "TMUX_REDRAW:" + state.marker + "\\r\\n");
  }
  process.stdin.setEncoding("utf8");
  let ready = false;
  process.stdin.on("data", (chunk) => {
    const text = String(chunk);
    if (/\x1b\[<\d+;\d+;\d+[mM]/.test(text)) {
      process.stdout.write("MOUSE_INPUT_FORWARDED\\r\\n");
    }
    const readyMarker = text.match(/__KR_[a-f0-9]+__/);
    if (readyMarker && !ready) {
      ready = true;
      process.stdout.write("/dev/pts/9\\r\\n" + readyMarker[0] + "\\r\\n$ ");
    }
    const first = text.match(/KODY_RUNTIME_FIRST_[0-9]+|KODY_TUI_FIRST_[0-9]+/);
    if (first) {
      const next = readState(name);
      next.marker = first[0];
      writeState(name, next);
      process.stdout.write(first[0] + "\\r\\n$ ");
    }
    const second = text.match(/KODY_RUNTIME_SECOND_[0-9]+|KODY_TUI_SECOND_[0-9]+/);
    if (second) {
      process.stdout.write(second[0] + "\\r\\n$ ");
    }
  });
  setInterval(() => {}, 1000);
  return;
}
console.error("unexpected tmux call: " + args.join(" "));
process.exit(1);
`,
  );
  const child = spawn(process.execPath, [join(dir, "bridge.mjs")], {
    cwd: dir,
    env: {
      ...process.env,
      BRIDGE_AUTH_SECRET: BRIDGE_SECRET,
      PORT: String(port),
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bridgeProcess = child;
  child.stdout?.on("data", (chunk) => {
    bridgeOutput += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk) => {
    bridgeOutput += chunk.toString("utf8");
  });
  await waitForHttpOk(`http://127.0.0.1:${port}/healthz`);
  return { port, dir };
}

function terminalToken(): string {
  return mintTerminalBridgeToken({
    owner: "acme",
    repo: "widgets",
    app: "kody-brain-alice",
    orgSlug: "personal",
    machineId: "brain-1",
    chatSessionId: "brain:acme:widgets:kody-brain-alice:brain-1",
    flyToken: "fly-token",
    cols: 100,
    rows: 30,
    secret: BRIDGE_SECRET,
  });
}

interface RuntimeSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
  messages: Record<string, unknown>[];
  events: string[];
  waitFor(predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

function clientFrame(opcode: number, payload: Buffer): Buffer {
  const headerLength = payload.length < 126 ? 2 : payload.length <= 0xffff ? 4 : 10;
  const header = Buffer.alloc(headerLength + 4);
  header[0] = 0x80 | opcode;
  if (payload.length < 126) {
    header[1] = 0x80 | payload.length;
  } else if (payload.length <= 0xffff) {
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const maskOffset = headerLength;
  const mask = crypto.randomBytes(4);
  mask.copy(header, maskOffset);
  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, masked]);
}

function watchSocket(socket: net.Socket, initial = Buffer.alloc(0)): RuntimeSocket {
  const messages: Record<string, unknown>[] = [];
  const events: string[] = [];
  let frameBuffer = initial;

  function consumeFrames(): void {
    while (frameBuffer.length >= 2) {
      const opcode = frameBuffer[0] & 0x0f;
      const masked = (frameBuffer[1] & 0x80) !== 0;
      let length = frameBuffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (frameBuffer.length < 4) return;
        length = frameBuffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (frameBuffer.length < 10) return;
        length = Number(frameBuffer.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLength = masked ? 4 : 0;
      if (frameBuffer.length < offset + maskLength + length) return;
      const mask = masked ? frameBuffer.subarray(offset, offset + 4) : null;
      offset += maskLength;
      const payload = Buffer.from(frameBuffer.subarray(offset, offset + length));
      frameBuffer = frameBuffer.subarray(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      if (opcode === 8) {
        events.push("close-frame");
        socket.end();
        continue;
      }
      if (opcode !== 1) continue;
      const raw = payload.toString("utf8");
      events.push(`message:${raw.slice(0, 40)}`);
      try {
        messages.push(JSON.parse(raw) as Record<string, unknown>);
      } catch (err) {
        events.push(`parse-error:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  socket.on("data", (chunk) => {
    events.push(
      `bytes:${chunk.length}:${chunk.subarray(0, 4).toString("hex")}:${chunk
        .toString("utf8")
        .slice(0, 180)}`,
    );
    frameBuffer = Buffer.concat([frameBuffer, chunk]);
    consumeFrames();
  });
  socket.on("close", () => {
    events.push("close");
  });
  socket.on("error", (err) => {
    events.push(`error:${err.message}`);
  });
  consumeFrames();

  return {
    close(code = 1000, reason = "") {
      const reasonBytes = Buffer.from(reason);
      const payload = Buffer.alloc(2 + reasonBytes.length);
      payload.writeUInt16BE(code, 0);
      reasonBytes.copy(payload, 2);
      socket.write(clientFrame(8, payload));
      socket.end();
    },
    messages,
    events,
    send(data: string) {
      socket.write(clientFrame(1, Buffer.from(data)));
    },
    async waitFor(predicate: (message: Record<string, unknown>) => boolean) {
      const deadline = Date.now() + 6_000;
      while (Date.now() < deadline) {
        const match = messages.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        `timed out waiting for websocket message; seen=${messages
          .map((message) => JSON.stringify(message))
          .join(" | ")}; events=${events.join(" | ")}; bridge=${bridgeOutput}`,
      );
    },
  };
}

async function openSocket(port: number, token: string): Promise<RuntimeSocket> {
  const socket = net.connect(port, "127.0.0.1");
  const key = crypto.randomBytes(16).toString("base64");
  const header = [
    `GET /?token=${encodeURIComponent(token)} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "\r\n",
  ].join("\r\n");
  let rest = Buffer.alloc(0);

  await new Promise<void>((resolve, reject) => {
    let handshake = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("websocket handshake timed out"));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      handshake = Buffer.concat([handshake, chunk]);
      const end = handshake.indexOf("\r\n\r\n");
      if (end === -1) return;
      const response = handshake.subarray(0, end).toString("utf8");
      cleanup();
      if (!response.startsWith("HTTP/1.1 101")) {
        reject(new Error(`websocket handshake failed: ${response}`));
        return;
      }
      rest = handshake.subarray(end + 4);
      resolve();
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(header);
  });

  return watchSocket(socket, rest);
}

afterEach(() => {
  bridgeProcess?.kill("SIGTERM");
  bridgeProcess = null;
  bridgeOutput = "";
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("terminal bridge runtime restore", () => {
  function expectNoTmuxStatusLine(probe: RuntimeSocket): void {
    expect(
      probe.messages.some(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(":flyctl]*"),
      ),
    ).toBe(false);
  }

  function expectTmuxScrollEnabled(probe: RuntimeSocket): void {
    expect(
      probe.messages.some(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes("TMUX_SCROLL_DISABLED"),
      ),
    ).toBe(false);
  }

  function expectTmuxMouseDisabled(probe: RuntimeSocket): void {
    expect(
      probe.messages.some(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes("TMUX_MOUSE_CAPTURED"),
      ),
    ).toBe(false);
  }

  async function expectNoOutputContaining(
    probe: RuntimeSocket,
    text: string,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(
      probe.messages.some(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(text),
      ),
    ).toBe(false);
  }

  it(
    "reattaches a refreshed websocket to the same live terminal",
    async () => {
      const { port } = await startBridge();
      const token = terminalToken();

      const firstSocket = await openSocket(port, token);
      const firstProbe = firstSocket;
      await firstProbe.waitFor((message) => message.type === "ready");
      const firstMarker = `KODY_RUNTIME_FIRST_${Date.now()}`;
      firstSocket.send(
        JSON.stringify({ type: "input", id: 1, data: `printf "${firstMarker}\\n"\r` }),
      );
      await firstProbe.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(firstMarker),
      );
      firstSocket.close(1000, "simulate browser refresh");

      const secondSocket = await openSocket(port, token);
      const secondProbe = secondSocket;
      await secondProbe.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(firstMarker),
      );
      await secondProbe.waitFor((message) => message.type === "ready");
      expectNoTmuxStatusLine(firstProbe);
      expectNoTmuxStatusLine(secondProbe);
      expectTmuxScrollEnabled(firstProbe);
      expectTmuxScrollEnabled(secondProbe);
      expectTmuxMouseDisabled(firstProbe);
      expectTmuxMouseDisabled(secondProbe);
      const secondMarker = `KODY_RUNTIME_SECOND_${Date.now()}`;
      secondSocket.send(
        JSON.stringify({ type: "input", id: 2, data: `printf "${secondMarker}\\n"\r` }),
      );
      await secondProbe.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(secondMarker),
      );
      secondSocket.close(1000, "done");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "restores a TUI screen from the terminal pane instead of replaying old output",
    async () => {
      const { port } = await startBridge();
      const token = terminalToken();

      const firstSocket = await openSocket(port, token);
      const firstProbe = firstSocket;
      await firstProbe.waitFor((message) => message.type === "ready");
      const firstMarker = `KODY_TUI_FIRST_${Date.now()}`;
      firstSocket.send(
        JSON.stringify({ type: "input", id: 1, data: `printf "${firstMarker}\\n"\r` }),
      );
      await firstProbe.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(firstMarker),
      );
      firstSocket.close(1000, "simulate browser refresh");

      const secondSocket = await openSocket(port, token);
      const secondProbe = secondSocket;
      await secondProbe.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes(`TMUX_REDRAW:${firstMarker}`),
      );
      await secondProbe.waitFor((message) => message.type === "ready");
      expectNoTmuxStatusLine(firstProbe);
      expectNoTmuxStatusLine(secondProbe);
      expectTmuxScrollEnabled(firstProbe);
      expectTmuxScrollEnabled(secondProbe);
      expectTmuxMouseDisabled(firstProbe);
      expectTmuxMouseDisabled(secondProbe);
      secondSocket.close(1000, "done");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "forwards browser resize messages to the PTY relay",
    async () => {
      const { port } = await startBridge();
      const token = terminalToken();

      const socket = await openSocket(port, token);
      await socket.waitFor((message) => message.type === "ready");

      socket.send(JSON.stringify({ type: "resize", cols: 120, rows: 44 }));

      await socket.waitFor(
        (message) =>
          message.type === "output" &&
          typeof message.data === "string" &&
          message.data.includes("PTY_RESIZE:120x44"),
      );
      socket.close(1000, "done");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "does not forward browser mouse packets as terminal input",
    async () => {
      const { port } = await startBridge();
      const token = terminalToken();

      const socket = await openSocket(port, token);
      await socket.waitFor((message) => message.type === "ready");

      socket.send(
        JSON.stringify({
          type: "input",
          id: 1,
          data: "\u001b[<0;12;5M\u001b[<0;12;5m",
        }),
      );

      await expectNoOutputContaining(socket, "MOUSE_INPUT_FORWARDED");
      socket.close(1000, "done");
    },
    TEST_TIMEOUT_MS,
  );
});
