/**
 * @fileType utility
 * @domain terminal
 * @pattern fly-terminal-bridge
 *
 * On-demand Fly app provisioner for the browser terminal bridge. The dashboard
 * owns this so operators do not configure a separate bridge URL.
 */
import crypto from "node:crypto";

import { logger } from "@dashboard/lib/logger";
import type { FlyPreviewConfig } from "@dashboard/lib/previews/fly-previews";
import { allocateIpsIfMissing } from "@dashboard/lib/runners/brain-fly";

const FLY_API_BASE = "https://api.machines.dev/v1";
const REQUEST_TIMEOUT_MS = 90_000;
const BRIDGE_HEALTH_TIMEOUT_MS = 90_000;
const BRIDGE_HEALTH_INTERVAL_MS = 2_000;
const BRIDGE_CREATE_ATTEMPTS = 3;

export const TERMINAL_BRIDGE_VERSION = "2026-07-08.2";
export const TERMINAL_BRIDGE_BASE_IMAGE =
  process.env.KODY_TERMINAL_BRIDGE_BASE_IMAGE ?? "node:22-bookworm";

const START_SCRIPT = String.raw`#!/bin/sh
set -eu

need_apt=0
command -v curl >/dev/null 2>&1 || need_apt=1
command -v python3 >/dev/null 2>&1 || need_apt=1
command -v tmux >/dev/null 2>&1 || need_apt=1

if [ "$need_apt" = "1" ]; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl python3 tmux
  rm -rf /var/lib/apt/lists/*
fi

if ! command -v flyctl >/dev/null 2>&1; then
  curl -L https://fly.io/install.sh | sh
  cp /root/.fly/bin/flyctl /usr/local/bin/flyctl
fi

mkdir -p /root/.fly
printf 'wire_guard_websockets: true\n' > /root/.fly/config.yml

exec node /app/bridge.mjs
`;

export const TERMINAL_BRIDGE_PTY_RELAY_SCRIPT = String.raw`#!/usr/bin/env python3
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import tty

if len(sys.argv) < 2:
    print("pty relay: missing command", file=sys.stderr)
    sys.exit(2)

rows = int(os.environ.get("LINES", "36") or "36")
cols = int(os.environ.get("COLUMNS", "120") or "120")

master, slave = os.openpty()

def set_winsize(fd, next_rows, next_cols):
    fcntl.ioctl(
        fd,
        termios.TIOCSWINSZ,
        struct.pack("HHHH", max(1, next_rows), max(1, next_cols), 0, 0),
    )

def disable_echo(fd):
    try:
        attrs = termios.tcgetattr(fd)
        no_echo_flags = termios.ECHO
        for flag_name in ("ECHOE", "ECHOK", "ECHONL", "ECHOCTL", "ECHOKE"):
            no_echo_flags |= getattr(termios, flag_name, 0)
        attrs[3] = attrs[3] & ~no_echo_flags
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
    except termios.error:
        pass

set_winsize(slave, rows, cols)
tty.setraw(slave)
disable_echo(slave)

pid = os.fork()
if pid == 0:
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    if master > 2:
        os.close(master)
    if slave > 2:
        os.close(slave)
    os.execvp(sys.argv[1], sys.argv[1:])

slave_control_fd = slave
stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()
control_fd = 3
try:
    os.fstat(control_fd)
except OSError:
    control_fd = None
stdin_open = True
control_open = control_fd is not None
control_buffer = b""

def stop_child(signum, frame):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

signal.signal(signal.SIGTERM, stop_child)
signal.signal(signal.SIGINT, stop_child)

exit_code = 0
while True:
    child_pid, status = os.waitpid(pid, os.WNOHANG)
    if child_pid == pid:
        if os.WIFEXITED(status):
            exit_code = os.WEXITSTATUS(status)
        elif os.WIFSIGNALED(status):
            exit_code = 128 + os.WTERMSIG(status)
        break

    read_fds = [master]
    if stdin_open:
        read_fds.append(stdin_fd)
    if control_open and control_fd is not None:
        read_fds.append(control_fd)
    readable, _, _ = select.select(read_fds, [], [], 0.25)
    if master in readable:
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(stdout_fd, data)
    if stdin_fd in readable:
        data = os.read(stdin_fd, 65536)
        if not data:
            stdin_open = False
            continue
        disable_echo(slave_control_fd)
        os.write(master, data)
    if control_open and control_fd is not None and control_fd in readable:
        data = os.read(control_fd, 65536)
        if not data:
            control_open = False
            continue
        control_buffer += data
        while b"\n" in control_buffer:
            line, control_buffer = control_buffer.split(b"\n", 1)
            try:
                message = json.loads(line.decode("utf8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            if message.get("type") == "resize":
                next_rows = int(message.get("rows") or rows)
                next_cols = int(message.get("cols") or cols)
                set_winsize(slave_control_fd, next_rows, next_cols)
                try:
                    os.kill(pid, signal.SIGWINCH)
                except ProcessLookupError:
                    pass

try:
    os.close(master)
except OSError:
    pass
try:
    os.close(slave_control_fd)
except OSError:
    pass
if control_fd is not None:
    try:
        os.close(control_fd)
    except OSError:
        pass

sys.exit(exit_code)
`;

export const TERMINAL_BRIDGE_SCRIPT = String.raw`import crypto from "node:crypto";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";

const TOKEN_VERSION = "kody-terminal-v1";
const SSH_STATUS_INTERVAL_MS = 10000;
const READY_TIMEOUT_MS = 75000;
const READY_PROBE_INTERVAL_MS = 2500;
const MAX_SSH_START_ATTEMPTS = 3;
const SSH_START_RETRY_DELAY_MS = 2000;
const PERSISTENT_SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_REPLAY_CHARS = 120000;
const MAX_EXEC_OUTPUT_BYTES = 96 * 1024 * 1024;
const MAX_EXEC_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const EXEC_KEEPALIVE_INTERVAL_MS = 15000;
const EXEC_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const TERMINAL_TMUX_HISTORY_LIMIT = "50000";
const secret = process.env.BRIDGE_AUTH_SECRET || "";
const persistentSessions = new Map();
const execJobs = new Map();
if (!secret) {
  console.error("BRIDGE_AUTH_SECRET missing");
  process.exit(1);
}

function fromBase64url(input) {
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return Buffer.from(padded.replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function deriveKey(purpose) {
  return crypto
    .createHash("sha256")
    .update("kody-terminal-bridge:" + purpose + ":" + secret)
    .digest();
}

function sign(parts) {
  return base64url(
    crypto.createHmac("sha256", deriveKey("hmac")).update(parts.join(".")).digest(),
  );
}

function timingSafeEqualString(a, b) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function verifyTerminalToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("terminal token malformed");
  const [header, encrypted, signature] = parts;
  if (!timingSafeEqualString(signature, sign([header, encrypted]))) {
    throw new Error("terminal token signature invalid");
  }
  const headerJson = JSON.parse(fromBase64url(header).toString("utf8"));
  if (headerJson.typ !== TOKEN_VERSION) {
    throw new Error("terminal token version invalid");
  }
  const packed = fromBase64url(encrypted);
  if (packed.length < 29) throw new Error("terminal token payload invalid");
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey("aes"), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  const claims = JSON.parse(plaintext);
  const now = Math.floor(Date.now() / 1000);
  if (claims.sub !== "kody-terminal") throw new Error("terminal token subject invalid");
  if (claims.exp < now) throw new Error("terminal token expired");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(claims.app)) {
    throw new Error("terminal token app invalid");
  }
  if (
    claims.orgSlug !== undefined &&
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(claims.orgSlug)
  ) {
    throw new Error("terminal token org invalid");
  }
  if (
    claims.machineId !== undefined &&
    !/^[A-Za-z0-9_-]{1,120}$/.test(claims.machineId)
  ) {
    throw new Error("terminal token machine invalid");
  }
  if (claims.localExec !== true && !claims.machineId) {
    throw new Error("terminal token machine required");
  }
  if (
    claims.chatSessionId !== undefined &&
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(claims.chatSessionId)
  ) {
    throw new Error("terminal token chat session invalid");
  }
  if (
    claims.resetSession !== undefined &&
    typeof claims.resetSession !== "boolean"
  ) {
    throw new Error("terminal token reset flag invalid");
  }
  if (
    claims.activityLimitMs !== undefined &&
    claims.activityLimitMs !== null &&
    (!Number.isFinite(claims.activityLimitMs) || claims.activityLimitMs < 60000)
  ) {
    throw new Error("terminal token activity limit invalid");
  }
  if (
    claims.localExec !== undefined &&
    typeof claims.localExec !== "boolean"
  ) {
    throw new Error("terminal token local exec flag invalid");
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(claims.owner)) {
    throw new Error("terminal token owner invalid");
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(claims.repo)) {
    throw new Error("terminal token repo invalid");
  }
  return claims;
}

function sendFrame(socket, opcode, payload) {
  if (!socket.writable) return;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  socket.write(Buffer.concat([header, body]));
}

function sendJson(socket, value) {
  sendFrame(socket, 1, JSON.stringify(value));
}

function closeSocket(socket, code, reason) {
  const text = Buffer.from(reason || "");
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  sendFrame(socket, 8, payload);
  socket.end();
}

function parseFrames(socket, onText) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(1024 * 1024)) {
          closeSocket(socket, 1009, "frame too large");
          return;
        }
        length = Number(big);
        offset = 10;
      }
      if (!masked) {
        closeSocket(socket, 1002, "client frames must be masked");
        return;
      }
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(offset + length);

      if (opcode === 8) {
        socket.end();
        return;
      }
      if (opcode === 9) {
        sendFrame(socket, 10, payload);
        continue;
      }
      if (opcode === 1) {
        onText(payload.toString("utf8"));
      }
    }
  });
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function execJsonResponse(res, runnerPromise) {
  res.writeHead(200, { "content-type": "application/json" });
  const keepalive = setInterval(() => {
    res.write(" ");
  }, EXEC_KEEPALIVE_INTERVAL_MS);
  runnerPromise
    .then((result) => {
      clearInterval(keepalive);
      res.end(JSON.stringify({ ok: true, ...result }));
    })
    .catch((err) => {
      clearInterval(keepalive);
      res.end(
        JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    });
}

function execJobScope(claims, local) {
  return {
    owner: claims.owner,
    repo: claims.repo,
    orgSlug: claims.orgSlug || "",
    app: claims.app,
    machineId: local ? null : claims.machineId,
    local,
  };
}

function canReadExecJob(claims, job) {
  if (!job) return false;
  if (job.scope.owner !== claims.owner) return false;
  if (job.scope.repo !== claims.repo) return false;
  if (job.scope.orgSlug !== (claims.orgSlug || "")) return false;
  if (job.scope.app !== claims.app) return false;
  if (job.scope.local) return claims.localExec === true;
  return job.scope.machineId === claims.machineId;
}

function publicExecJob(job) {
  return {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    code: job.code,
    stdout: job.stdout,
    stderr: job.stderr,
    error: job.error,
  };
}

function startExecJob(claims, runner, local, command, timeoutMs, maxOutputBytes) {
  const id = crypto.randomBytes(16).toString("hex");
  const job = {
    id,
    status: "running",
    scope: execJobScope(claims, local),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    code: null,
    stdout: "",
    stderr: "",
    error: null,
  };
  execJobs.set(id, job);
  runner(claims, command, timeoutMs, maxOutputBytes, {
    onStdout: (chunk) => {
      job.stdout += chunk.toString("utf8");
    },
    onStderr: (chunk) => {
      job.stderr += chunk.toString("utf8");
    },
  })
    .then((result) => {
      job.code = result.code ?? 0;
      job.stdout = result.stdout ?? "";
      job.stderr = result.stderr ?? "";
      job.status = job.code === 0 ? "completed" : "failed";
      job.error =
        job.code === 0
          ? null
          : job.stderr.trim().slice(0, 1000) ||
            "Command failed with exit " + job.code;
    })
    .catch((err) => {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return job;
}

function readRequestJson(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw.trim() ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

function appendOutput(chunks, state, chunk, maxOutputBytes, onChunk) {
  state.size += chunk.length;
  if (state.size > maxOutputBytes) {
    throw new Error("command output too large");
  }
  chunks.push(chunk);
  if (onChunk) onChunk(chunk);
}

function runOneShotFlyCommand(
  claims,
  command,
  timeoutMs,
  maxOutputBytes,
  liveOutput,
) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FLY_API_TOKEN: claims.flyToken,
      TERM: "dumb",
    };
    const args = [
      "ssh",
      "console",
      "--app",
      claims.app,
      ...flyctlOrgArgs(claims.orgSlug),
      "--machine",
      claims.machineId,
      "--command",
      command,
    ];
    const child = spawn("flyctl", args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const stdoutState = { size: 0 };
    const stderrState = { size: 0 };
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      finish(reject, new Error("command timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      try {
        appendOutput(
          stdout,
          stdoutState,
          chunk,
          maxOutputBytes,
          liveOutput && liveOutput.onStdout,
        );
      } catch (err) {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, err);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        appendOutput(
          stderr,
          stderrState,
          chunk,
          1024 * 1024,
          liveOutput && liveOutput.onStderr,
        );
      } catch (err) {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, err);
      }
    });
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      finish(resolve, {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function runOneShotLocalCommand(
  claims,
  command,
  timeoutMs,
  maxOutputBytes,
  liveOutput,
) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      FLY_API_TOKEN: claims.flyToken,
      FLY_ACCESS_TOKEN: claims.flyToken,
      GHCR_TOKEN: claims.ghcrToken || "",
      NO_COLOR: "1",
      TERM: "dumb",
    };
    const child = spawn("/bin/bash", ["-lc", command], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    const stdoutState = { size: 0 };
    const stderrState = { size: 0 };
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      finish(reject, new Error("command timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      try {
        appendOutput(
          stdout,
          stdoutState,
          chunk,
          maxOutputBytes,
          liveOutput && liveOutput.onStdout,
        );
      } catch (err) {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, err);
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        appendOutput(
          stderr,
          stderrState,
          chunk,
          1024 * 1024,
          liveOutput && liveOutput.onStderr,
        );
      } catch (err) {
        try {
          child.kill("SIGTERM");
        } catch {}
        finish(reject, err);
      }
    });
    child.on("error", (err) => finish(reject, err));
    child.on("close", (code) => {
      finish(resolve, {
        code: code ?? 0,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function flyctlOrgArgs(orgSlug) {
  return orgSlug && orgSlug !== "personal" ? ["--org", orgSlug] : [];
}

function persistentSessionKey(claims) {
  if (!claims.chatSessionId) return null;
  return [
    claims.owner,
    claims.repo,
    claims.orgSlug || "",
    claims.app,
    claims.machineId,
    claims.chatSessionId,
  ].join("::");
}

function directFlySshCommand(claims) {
  return [
    "flyctl",
    "ssh",
    "console",
    "--app",
    claims.app,
    ...flyctlOrgArgs(claims.orgSlug),
    "--machine",
    claims.machineId,
    "--pty",
  ];
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_/:.,+=@%~-]+$/.test(text)) return text;
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

function tmuxPaneCommand(claims) {
  return directFlySshCommand(claims).map(shellQuote).join(" ");
}

function tmuxSessionName(claims) {
  const key = persistentSessionKey(claims);
  if (!key) return null;
  return "kody_" + crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function killTmuxSession(sessionName) {
  if (!sessionName) return;
  spawnSync("tmux", ["kill-session", "-t", sessionName], {
    stdio: "ignore",
  });
}

function hasTmuxSession(sessionName) {
  if (!sessionName) return false;
  const result = spawnSync("tmux", ["has-session", "-t", sessionName], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function configureTmuxSession(sessionName) {
  const options = [
    ["status", "off"],
    ["mouse", "off"],
    ["history-limit", TERMINAL_TMUX_HISTORY_LIMIT],
  ];
  for (const [name, value] of options) {
    const result = spawnSync("tmux", ["set-option", "-t", sessionName, name, value], {
      stdio: "ignore",
    });
    if (result.status !== 0) {
      throw new Error("failed to configure terminal tmux session");
    }
  }
}

function ensureTmuxSession(claims, sessionName, env) {
  if (hasTmuxSession(sessionName)) {
    configureTmuxSession(sessionName);
    return { created: false };
  }
  const result = spawnSync(
    "tmux",
    ["new-session", "-d", "-s", sessionName, tmuxPaneCommand(claims)],
    { env, stdio: "ignore" },
  );
  if (result.status !== 0) {
    throw new Error("failed to start terminal tmux session");
  }
  configureTmuxSession(sessionName);
  return { created: true };
}

function rememberOutput(session, text) {
  if (!text) return;
  session.outputBuffer = (session.outputBuffer + text).slice(-MAX_REPLAY_CHARS);
}

function sendToSession(session, value) {
  for (const socket of session.sockets) {
    sendJson(socket, value);
  }
}

function closeSessionSockets(session, code, reason) {
  for (const socket of session.sockets) {
    closeSocket(socket, code, reason);
  }
  session.sockets.clear();
}

function cleanupSession(session) {
  clearInterval(session.statusTimer);
  clearInterval(session.readyProbeTimer);
  clearTimeout(session.readyTimer);
  clearTimeout(session.retryTimer);
}

function disposePersistentSession(key, session) {
  cleanupSession(session);
  closeSessionSockets(session, 1000, "terminal session closed");
  killTmuxSession(session.tmuxSessionName);
  try {
    session.child.kill("SIGTERM");
  } catch {}
  persistentSessions.delete(key);
}

function normalizeActivityLimitMs(value) {
  if (value === null) return null;
  if (Number.isFinite(value) && value >= 60000) return value;
  return PERSISTENT_SESSION_IDLE_MS;
}

function isRetryableFlySshStartupFailure(output) {
  const text = String(output || "").toLowerCase();
  return (
    text.includes("tunnel unavailable") ||
    text.includes("error contacting fly.io api") ||
    text.includes("context deadline exceeded") ||
    text.includes("i/o timeout")
  );
}

function normalizeTerminalSize(cols, rows) {
  const nextCols = Number(cols);
  const nextRows = Number(rows);
  if (!Number.isFinite(nextCols) || !Number.isFinite(nextRows)) return null;
  return {
    cols: Math.min(1000, Math.max(1, Math.floor(nextCols))),
    rows: Math.min(1000, Math.max(1, Math.floor(nextRows))),
  };
}

function stripTerminalMouseInput(value) {
  return String(value || "")
    .replace(/\x1b\[<\d+;\d+;\d+[mM]/g, "")
    .replace(/\x1b\[M[\s\S]{3}/g, "");
}

function sendResizeToPty(session, cols, rows) {
  const size = normalizeTerminalSize(cols, rows);
  const control = session.resizeControl;
  if (!size || !control || control.destroyed || !control.writable) return;
  control.write(JSON.stringify({ type: "resize", ...size }) + "\n");
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of persistentSessions) {
    if (
      session.activityLimitMs !== null &&
      now - session.lastTouched > session.activityLimitMs
    ) {
      disposePersistentSession(key, session);
    }
  }
  for (const [key, job] of execJobs) {
    const finished = job.finishedAt ? Date.parse(job.finishedAt) : NaN;
    if (Number.isFinite(finished) && now - finished > EXEC_JOB_TTL_MS) {
      execJobs.delete(key);
    }
  }
}, 60000).unref?.();

function createFlyConsoleSession(claims, key) {
  const env = {
    ...process.env,
    FLY_API_TOKEN: claims.flyToken,
    FLY_ACCESS_TOKEN: claims.flyToken,
    TERM: "xterm-256color",
    COLUMNS: String(claims.cols || 120),
    LINES: String(claims.rows || 36),
  };
  const readyMarker = "__KR_" + crypto.randomBytes(4).toString("hex") + "__";
  const tmuxName = key ? tmuxSessionName(claims) : null;
  const tmuxState = tmuxName ? ensureTmuxSession(claims, tmuxName, env) : null;
  const command = tmuxName
    ? ["tmux", "attach-session", "-t", tmuxName]
    : directFlySshCommand(claims);
  const args = ["/app/pty-relay.py", ...command];
  const session = {
    child: null,
    sockets: new Set(),
    key,
    tmuxSessionName: tmuxName,
    readyMarker,
    sawOutput: false,
    ready: Boolean(tmuxName && !tmuxState?.created),
    timedOut: false,
    detaching: false,
    startAttempts: 0,
    pendingOutput: "",
    outputBuffer: "",
    inputBytes: 0,
    lastTouched: Date.now(),
    activityLimitMs: normalizeActivityLimitMs(claims.activityLimitMs),
    statusTimer: null,
    readyProbeTimer: null,
    readyTimer: null,
    retryTimer: null,
    resizeControl: null,
    restartChild: null,
  };
  const statusTimer = setInterval(() => {
    if (!session.sawOutput) {
      sendToSession(session, {
        type: "output",
        data: "Still opening real terminal...\r\n",
      });
    }
  }, SSH_STATUS_INTERVAL_MS);
  const readyTimer = setTimeout(() => {
    if (session.ready) return;
    if (session.pendingOutput) {
      rememberOutput(session, session.pendingOutput);
      sendToSession(session, { type: "output", data: session.pendingOutput });
      session.pendingOutput = "";
    }
    sendToSession(session, {
      type: "error",
      message: "Terminal did not answer the keyboard self-test.",
    });
    session.timedOut = true;
    session.child?.kill("SIGTERM");
  }, READY_TIMEOUT_MS);
  session.statusTimer = statusTimer;
  session.readyTimer = readyTimer;

  function findReadyProof(output) {
    const ttyPattern = /\/dev\/(?:pts\/[0-9]+|tty[^\s\r\n]*)/g;
    let match;
    while ((match = ttyPattern.exec(output)) !== null) {
      const markerIndex = output.indexOf(readyMarker, match.index + match[0].length);
      if (markerIndex !== -1) {
        return { tty: match[0], markerIndex };
      }
    }
    return null;
  }

  function outputAfterReady(output, markerIndex) {
    return output
      .slice(markerIndex + readyMarker.length)
      .replace(/^[^\r\n]*(\r\n|\n|\r)?/, "");
  }

  function handleOutput(chunk) {
    const text = chunk.toString("utf8");
    session.sawOutput = true;
    session.lastTouched = Date.now();
    clearInterval(statusTimer);
    if (!session.ready) {
      session.pendingOutput += text;
      const proof = findReadyProof(session.pendingOutput);
      if (!proof) return;
      session.ready = true;
      clearInterval(session.readyProbeTimer);
      session.readyProbeTimer = null;
      clearTimeout(readyTimer);
      const cleanOutput = outputAfterReady(
        session.pendingOutput,
        proof.markerIndex,
      );
      session.pendingOutput = "";
      sendToSession(session, { type: "ready" });
      if (cleanOutput) {
        rememberOutput(session, cleanOutput);
        sendToSession(session, { type: "output", data: cleanOutput });
      }
      return;
    }
    rememberOutput(session, text);
    sendToSession(session, { type: "output", data: text });
  }

  function startChild() {
    if (session.child) return;
    session.startAttempts += 1;
    session.sawOutput = false;
    const child = spawn("python3", args, {
      env,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    session.child = child;
    session.resizeControl = child.stdio[3] || null;

    child.stdout.on("data", handleOutput);
    child.stderr.on("data", handleOutput);
    clearInterval(session.readyProbeTimer);
    session.readyProbeTimer = setInterval(() => {
      if (session.child !== child || child.stdin.destroyed) return;
      if (session.ready) {
        clearInterval(session.readyProbeTimer);
        session.readyProbeTimer = null;
        return;
      }
      child.stdin.write("tty; printf '\\n" + readyMarker + "\\n'\r");
    }, READY_PROBE_INTERVAL_MS);
    child.on("error", (err) => {
      if (session.child !== child) return;
      cleanupSession(session);
      sendToSession(session, { type: "error", message: err.message });
      closeSessionSockets(session, 1011, "terminal process failed");
      if (key) persistentSessions.delete(key);
    });
    child.on("close", (code) => {
      if (session.child !== child) return;
      clearInterval(session.readyProbeTimer);
      session.readyProbeTimer = null;
      if (session.detaching) {
        session.detaching = false;
        session.child = null;
        if (
          session.key &&
          session.sockets.size > 0 &&
          typeof session.restartChild === "function"
        ) {
          session.restartChild();
        }
        return;
      }
      if (
        !session.ready &&
        !session.timedOut &&
        session.startAttempts < MAX_SSH_START_ATTEMPTS &&
        isRetryableFlySshStartupFailure(session.pendingOutput)
      ) {
        if (session.pendingOutput) {
          rememberOutput(session, session.pendingOutput);
          sendToSession(session, {
            type: "output",
            data: session.pendingOutput,
          });
          session.pendingOutput = "";
        }
        sendToSession(session, {
          type: "output",
          data:
            "Retrying terminal tunnel (" +
            (session.startAttempts + 1) +
            "/" +
            MAX_SSH_START_ATTEMPTS +
            ")...\r\n",
        });
        session.retryTimer = setTimeout(startChild, SSH_START_RETRY_DELAY_MS);
        return;
      }
      cleanupSession(session);
      if (!session.ready && session.pendingOutput) {
        rememberOutput(session, session.pendingOutput);
        sendToSession(session, { type: "output", data: session.pendingOutput });
        session.pendingOutput = "";
      }
      sendToSession(session, { type: "exit", code: code ?? 0 });
      closeSessionSockets(session, 1000, "terminal closed");
      if (key) persistentSessions.delete(key);
    });
  }

  session.restartChild = startChild;
  startChild();

  return session;
}

function attachSocketToSession(socket, session) {
  if (session.key && !session.child && typeof session.restartChild === "function") {
    session.restartChild();
  }
  session.sockets.add(socket);
  session.lastTouched = Date.now();

  function detach() {
    session.sockets.delete(socket);
    session.lastTouched = Date.now();
    if (session.key && session.sockets.size === 0) {
      session.detaching = true;
      try {
        session.child?.kill("SIGTERM");
      } catch {}
      return;
    }
    if (!session.key) {
      cleanupSession(session);
      try {
        session.child.kill("SIGTERM");
      } catch {}
    }
  }

  socket.on("close", detach);
  socket.on("end", detach);
  socket.on("error", detach);

  parseFrames(socket, (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === "input" && typeof msg.data === "string") {
      const inputData = stripTerminalMouseInput(msg.data);
      session.inputBytes += Buffer.byteLength(inputData);
      session.lastTouched = Date.now();
      console.log("terminal input bytes=" + session.inputBytes);
      if (!inputData) {
        sendJson(socket, {
          type: "input-accepted",
          id: msg.id,
          bytes: 0,
        });
        return;
      }
      if (session.child.stdin.destroyed || !session.child.stdin.writable) {
        sendJson(socket, {
          type: "input-rejected",
          id: msg.id,
          message: "Terminal stdin is closed.",
        });
        return;
      }
      session.child.stdin.write(inputData, (err) => {
        sendJson(socket, err
          ? {
              type: "input-rejected",
              id: msg.id,
              message: err.message || "Terminal stdin write failed.",
            }
          : {
              type: "input-accepted",
              id: msg.id,
              bytes: Buffer.byteLength(inputData),
            });
      });
      return;
    }
    if (msg.type === "resize") {
      session.lastTouched = Date.now();
      sendResizeToPty(session, msg.cols, msg.rows);
    }
  });

  if (!session.ready) {
    sendJson(socket, {
      type: "output",
      data: "Opening real terminal...\r\n",
    });
  }
  if (session.ready) {
    sendJson(socket, { type: "ready" });
  }
}

function startFlyConsole(socket, claims) {
  const key = persistentSessionKey(claims);
  if (key && claims.resetSession) {
    const existing = persistentSessions.get(key);
    if (existing) disposePersistentSession(key, existing);
    else killTmuxSession(tmuxSessionName(claims));
  }
  if (key) {
    const existing = persistentSessions.get(key);
    if (existing) {
      attachSocketToSession(socket, existing);
      return;
    }
  }
  const session = createFlyConsoleSession(claims, key);
  if (key) persistentSessions.set(key, session);
  attachSocketToSession(socket, session);
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  try {
    const url = new URL(req.url || "/", "http://terminal-bridge.internal");
    if (url.pathname === "/status") {
      const claims = verifyTerminalToken(url.searchParams.get("token"));
      const key = persistentSessionKey(claims);
      const session = key ? persistentSessions.get(key) : null;
      const sessionName = key ? tmuxSessionName(claims) : null;
      const detachedTmuxAlive = Boolean(
        !session && sessionName && hasTmuxSession(sessionName),
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          alive: Boolean(session) || detachedTmuxAlive,
          ready: Boolean(session?.ready) || detachedTmuxAlive,
          socketCount: session?.sockets.size ?? 0,
          lastTouched: session?.lastTouched ?? null,
        }),
      );
      return;
    }
    if (url.pathname === "/exec" && req.method === "POST") {
      const auth = req.headers.authorization || "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice("bearer ".length)
        : "";
      const claims = verifyTerminalToken(
        bearer || url.searchParams.get("token"),
      );
      readRequestJson(req)
        .then((body) => {
          const command = typeof body.command === "string" ? body.command : "";
          if (!command.trim()) {
            jsonResponse(res, 400, { ok: false, error: "command required" });
            return;
          }
          if (command.length > 20000) {
            jsonResponse(res, 400, { ok: false, error: "command too long" });
            return;
          }
          const timeoutMs = Math.min(
            Math.max(Number(body.timeoutMs) || 60000, 1000),
            MAX_EXEC_TIMEOUT_MS,
          );
          const maxOutputBytes = Math.min(
            Math.max(
              Number(body.maxOutputBytes) || MAX_EXEC_OUTPUT_BYTES,
              1024,
            ),
            MAX_EXEC_OUTPUT_BYTES,
          );
          if (body.local === true && claims.localExec !== true) {
            jsonResponse(res, 403, {
              ok: false,
              error: "local exec not allowed",
            });
            return;
          }
          const runner =
            body.local === true
              ? runOneShotLocalCommand
              : runOneShotFlyCommand;
          execJsonResponse(
            res,
            runner(claims, command, timeoutMs, maxOutputBytes),
          );
          return;
        })
        .catch((err) => {
          jsonResponse(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }
    if (url.pathname === "/jobs" && req.method === "POST") {
      const auth = req.headers.authorization || "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice("bearer ".length)
        : "";
      const claims = verifyTerminalToken(
        bearer || url.searchParams.get("token"),
      );
      readRequestJson(req)
        .then((body) => {
          const command = typeof body.command === "string" ? body.command : "";
          if (!command.trim()) {
            jsonResponse(res, 400, { ok: false, error: "command required" });
            return;
          }
          if (command.length > 20000) {
            jsonResponse(res, 400, { ok: false, error: "command too long" });
            return;
          }
          const timeoutMs = Math.min(
            Math.max(Number(body.timeoutMs) || 60000, 1000),
            MAX_EXEC_TIMEOUT_MS,
          );
          const maxOutputBytes = Math.min(
            Math.max(
              Number(body.maxOutputBytes) || MAX_EXEC_OUTPUT_BYTES,
              1024,
            ),
            MAX_EXEC_OUTPUT_BYTES,
          );
          const local = body.local === true;
          if (local && claims.localExec !== true) {
            jsonResponse(res, 403, {
              ok: false,
              error: "local exec not allowed",
            });
            return;
          }
          const runner = local ? runOneShotLocalCommand : runOneShotFlyCommand;
          const job = startExecJob(
            claims,
            runner,
            local,
            command,
            timeoutMs,
            maxOutputBytes,
          );
          jsonResponse(res, 202, { ok: true, job: publicExecJob(job) });
        })
        .catch((err) => {
          jsonResponse(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }
    if (url.pathname.startsWith("/jobs/") && req.method === "GET") {
      const auth = req.headers.authorization || "";
      const bearer = auth.toLowerCase().startsWith("bearer ")
        ? auth.slice("bearer ".length)
        : "";
      const claims = verifyTerminalToken(
        bearer || url.searchParams.get("token"),
      );
      const jobId = url.pathname.slice("/jobs/".length);
      const job = /^[a-f0-9]{32}$/.test(jobId) ? execJobs.get(jobId) : null;
      if (!job || !canReadExecJob(claims, job)) {
        jsonResponse(res, 404, { ok: false, error: "job not found" });
        return;
      }
      jsonResponse(res, 200, { ok: true, job: publicExecJob(job) });
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unauthorized";
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("terminal bridge");
});

server.on("upgrade", (req, socket) => {
  try {
    const url = new URL(req.url || "/", "http://terminal-bridge.internal");
    const token = url.searchParams.get("token");
    const claims = verifyTerminalToken(token);
    const key = req.headers["sec-websocket-key"];
    if (!key) throw new Error("missing websocket key");
    const accept = crypto
      .createHash("sha1")
      .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n",
    );
    startFlyConsole(socket, claims);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unauthorized";
    socket.write(
      "HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n" +
        message,
    );
    socket.destroy();
  }
});

const port = Number(process.env.PORT || 8080);
server.listen(port, "0.0.0.0", () => {
  console.log("terminal bridge listening on " + port);
});
`;

interface FlyFetchOpts {
  method?: "GET" | "POST" | "DELETE";
  token: string;
  body?: unknown;
  allow404?: boolean;
}

interface FlyApp {
  name?: string;
  organization?: { slug?: string };
}

interface FlyMachine {
  id: string;
  state?: string;
  region?: string;
  config?: {
    image?: string;
    env?: Record<string, string>;
  };
}

export interface TerminalBridgeInfo {
  app: string;
  url: string;
  machineId: string;
  secret: string;
}

async function flyFetch<T>(
  path: string,
  opts: FlyFetchOpts,
): Promise<T | null> {
  const res = await fetch(`${FLY_API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 404 && opts.allow404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(
      `Fly Machines API ${res.status} on ${path}: ${text.slice(0, 200) || res.statusText}`,
    ) as Error & { status?: number; body?: string; path?: string };
    error.status = res.status;
    error.body = text;
    error.path = path;
    throw error;
  }
  if (res.status === 204) return null;
  const raw = await res.text();
  return raw.trim() ? (JSON.parse(raw) as T) : null;
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "fly"
  );
}

export function terminalBridgeAppName(cfg: FlyPreviewConfig): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${cfg.orgSlug}:${cfg.token}`)
    .digest("hex")
    .slice(0, 12);
  return `kody-terminal-${slugify(cfg.orgSlug)}-${hash}`;
}

function generateBridgeSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

function bridgeUrl(app: string): string {
  return `https://${app}.fly.dev`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridgeHealth(url: string): Promise<void> {
  const deadline = Date.now() + BRIDGE_HEALTH_TIMEOUT_MS;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(BRIDGE_HEALTH_INTERVAL_MS);
  }
  throw new Error(`terminal bridge: health check failed (${lastError})`);
}

async function ensureApp(cfg: FlyPreviewConfig, app: string): Promise<boolean> {
  const existing = await flyFetch<FlyApp>(`/apps/${encodeURIComponent(app)}`, {
    token: cfg.token,
    allow404: true,
  });
  if (existing) return false;
  try {
    await flyFetch<FlyApp>("/apps", {
      method: "POST",
      token: cfg.token,
      body: { app_name: app, org_slug: cfg.orgSlug },
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 422) throw err;
  }
  await allocateIpsIfMissing(cfg.token, app);
  return true;
}

function liveMachine(m: FlyMachine): boolean {
  return m.state !== "destroyed" && m.state !== "destroying";
}

async function findExistingMachine(
  cfg: FlyPreviewConfig,
  app: string,
): Promise<FlyMachine | null> {
  const machines = await listExistingMachines(cfg, app);
  return machines[0] ?? null;
}

async function listExistingMachines(
  cfg: FlyPreviewConfig,
  app: string,
): Promise<FlyMachine[]> {
  const machines = await flyFetch<FlyMachine[]>(
    `/apps/${encodeURIComponent(app)}/machines`,
    { token: cfg.token, allow404: true },
  );
  return machines?.filter(liveMachine) ?? [];
}

async function destroyMachine(
  cfg: FlyPreviewConfig,
  app: string,
  machineId: string,
): Promise<void> {
  await flyFetch<unknown>(
    `/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(
      machineId,
    )}?force=true`,
    { method: "DELETE", token: cfg.token, allow404: true },
  );
}

function machineSecret(machine: FlyMachine): string | null {
  const value = machine.config?.env?.BRIDGE_AUTH_SECRET;
  return typeof value === "string" && value.trim() ? value : null;
}

function sameImageRepoTag(a: string, b: string): boolean {
  const repoTag = (ref: string) => {
    const at = ref.indexOf("@");
    return at === -1 ? ref : ref.slice(0, at);
  };
  return repoTag(a) === repoTag(b);
}

function canReuseMachine(machine: FlyMachine): boolean {
  const env = machine.config?.env ?? {};
  return (
    env.KODY_TERMINAL_BRIDGE_VERSION === TERMINAL_BRIDGE_VERSION &&
    sameImageRepoTag(machine.config?.image ?? "", TERMINAL_BRIDGE_BASE_IMAGE) &&
    Boolean(machineSecret(machine))
  );
}

function isMachineNameConflict(err: unknown): boolean {
  const error = err as { status?: number; body?: string } | undefined;
  return (
    error?.status === 409 &&
    typeof error.body === "string" &&
    error.body.includes("unique machine name violation")
  );
}

async function createBridgeMachine(
  cfg: FlyPreviewConfig,
  app: string,
  secret: string,
): Promise<FlyMachine> {
  const body = {
    name: `terminal-${cfg.defaultRegion}`,
    region: cfg.defaultRegion,
    config: {
      image: TERMINAL_BRIDGE_BASE_IMAGE,
      env: {
        PORT: "8080",
        BRIDGE_AUTH_SECRET: secret,
        KODY_TERMINAL_BRIDGE_VERSION: TERMINAL_BRIDGE_VERSION,
      },
      files: [
        {
          guest_path: "/app/start.sh",
          raw_value: Buffer.from(START_SCRIPT).toString("base64"),
        },
        {
          guest_path: "/app/bridge.mjs",
          raw_value: Buffer.from(TERMINAL_BRIDGE_SCRIPT).toString("base64"),
        },
        {
          guest_path: "/app/pty-relay.py",
          raw_value: Buffer.from(TERMINAL_BRIDGE_PTY_RELAY_SCRIPT).toString(
            "base64",
          ),
        },
      ],
      init: { exec: ["sh", "/app/start.sh"] },
      auto_destroy: false,
      restart: { policy: "on-failure", max_retries: 3 },
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      services: [
        {
          ports: [
            { port: 443, handlers: ["tls", "http"] },
            { port: 80, handlers: ["http"], force_https: true },
          ],
          protocol: "tcp",
          internal_port: 8080,
          autostop: "suspend",
          autostart: true,
          min_machines_running: 0,
          concurrency: { type: "connections", soft_limit: 25, hard_limit: 50 },
        },
      ],
      checks: {
        healthz: {
          type: "http",
          port: 8080,
          method: "GET",
          path: "/healthz",
          interval: "30s",
          timeout: "5s",
          grace_period: "120s",
        },
      },
    },
  };

  const machine = await flyFetch<FlyMachine>(
    `/apps/${encodeURIComponent(app)}/machines`,
    { method: "POST", token: cfg.token, body },
  );
  if (!machine?.id)
    throw new Error("terminal bridge: create machine returned empty");
  return machine;
}

async function createOrConvergeBridgeMachine(input: {
  cfg: FlyPreviewConfig;
  app: string;
  secret: string;
}): Promise<{ machine: FlyMachine; secret: string }> {
  let lastConflict: unknown = null;
  for (let attempt = 1; attempt <= BRIDGE_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return {
        machine: await createBridgeMachine(input.cfg, input.app, input.secret),
        secret: input.secret,
      };
    } catch (err) {
      if (!isMachineNameConflict(err)) throw err;
      lastConflict = err;
      const conflicting = await findExistingMachine(input.cfg, input.app);
      if (conflicting && canReuseMachine(conflicting)) {
        return {
          machine: conflicting,
          secret: machineSecret(conflicting)!,
        };
      }
      if (conflicting?.id) {
        logger.info(
          { app: input.app, machineId: conflicting.id, attempt },
          "terminal bridge: removing stale conflicting bridge machine",
        );
        await destroyMachine(input.cfg, input.app, conflicting.id);
      }
    }
  }
  throw lastConflict instanceof Error
    ? lastConflict
    : new Error("terminal bridge: machine name conflict did not converge");
}

export async function ensureTerminalBridge(
  cfg: FlyPreviewConfig,
): Promise<TerminalBridgeInfo> {
  if (!cfg.token.trim()) {
    throw new Error("terminal bridge: fly token required");
  }
  const app = terminalBridgeAppName(cfg);
  const appWasCreated = await ensureApp(cfg, app);

  const existingMachines = await listExistingMachines(cfg, app);
  const reusableMachines = existingMachines.filter(canReuseMachine);
  const existing = reusableMachines[0] ?? existingMachines[0] ?? null;
  if (existing && canReuseMachine(existing)) {
    for (const extra of existingMachines) {
      if (extra.id !== existing.id) {
        await destroyMachine(cfg, app, extra.id);
      }
    }
    const secret = machineSecret(existing)!;
    const url = bridgeUrl(app);
    try {
      await waitForBridgeHealth(url);
    } catch (err) {
      logger.warn(
        { err, app, machineId: existing.id },
        "terminal bridge: reusable bridge failed health check; ensuring IPs",
      );
      await allocateIpsIfMissing(cfg.token, app);
      await waitForBridgeHealth(url);
    }
    return {
      app,
      url,
      machineId: existing.id,
      secret,
    };
  }

  if (existing) {
    logger.info(
      { app, machineId: existing.id },
      "terminal bridge: replacing stale bridge machine",
    );
    await destroyMachine(cfg, app, existing.id);
  }

  if (!appWasCreated) {
    await allocateIpsIfMissing(cfg.token, app);
  }
  const secret = generateBridgeSecret();
  const created = await createOrConvergeBridgeMachine({ cfg, app, secret });
  const machine = created.machine;
  logger.info(
    { app, machineId: machine.id },
    "terminal bridge: machine provisioned",
  );
  const url = bridgeUrl(app);
  await waitForBridgeHealth(url);
  return {
    app,
    url,
    machineId: machine.id,
    secret: created.secret,
  };
}

export async function findTerminalBridge(
  cfg: FlyPreviewConfig,
): Promise<TerminalBridgeInfo | null> {
  if (!cfg.token.trim()) return null;
  const app = terminalBridgeAppName(cfg);
  const existingApp = await flyFetch<FlyApp>(
    `/apps/${encodeURIComponent(app)}`,
    {
      token: cfg.token,
      allow404: true,
    },
  );
  if (!existingApp) return null;

  const existing = await findExistingMachine(cfg, app);
  if (!existing || !canReuseMachine(existing)) return null;
  const secret = machineSecret(existing);
  if (!secret) return null;
  const url = bridgeUrl(app);
  await waitForBridgeHealth(url);
  return {
    app,
    url,
    machineId: existing.id,
    secret,
  };
}
