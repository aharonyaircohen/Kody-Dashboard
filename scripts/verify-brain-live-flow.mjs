#!/usr/bin/env node
/**
 * Live verifier for the Brain terminal/image/checkpoint flow.
 *
 * Safe default:
 *   - reads Brain status
 *   - verifies terminal session route and websocket command execution
 *   - verifies terminal status route
 *   - verifies checkpoint API with a local, disposable checkpoint
 *
 * Full restore proof is gated:
 *   KODY_LIVE_ALLOW_SAVE=1 KODY_LIVE_ALLOW_DESTRUCTIVE=1 pnpm test:live:brain
 *
 * Required auth:
 *   KODY_LIVE_GITHUB_TOKEN or GITHUB_TOKEN or KODY_BOT_TOKEN
 *   KODY_LIVE_REPO_SLUG=owner/repo, or KODY_LIVE_OWNER + KODY_LIVE_REPO
 */
import fs from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import dotenv from "dotenv";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false, quiet: true });
  }
}

const startedAt = Date.now();
const baseUrl = env("KODY_LIVE_BASE_URL") ?? "http://localhost:3333";
const token =
  env("KODY_LIVE_GITHUB_TOKEN") ??
  env("E2E_GITHUB_TOKEN") ??
  env("GITHUB_TOKEN") ??
  env("KODY_BOT_TOKEN") ??
  env("GH_TOKEN");
const repo = resolveRepo();
const allowSave = truthy("KODY_LIVE_ALLOW_SAVE");
const allowDestructive = truthy("KODY_LIVE_ALLOW_DESTRUCTIVE");
const allowProvision = truthy("KODY_LIVE_ALLOW_PROVISION") || allowDestructive;
const allowApply = truthy("KODY_LIVE_ALLOW_APPLY") || allowDestructive;
const allowBrainCheckpointMutation = truthy(
  "KODY_LIVE_ALLOW_CHECKPOINT_MUTATION",
);
const markerPath =
  env("KODY_LIVE_MARKER_PATH") ?? "/usr/local/kody-live-restore-marker";
const marker = `kody-live-${new Date().toISOString()}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;
const chatSessionId = `live-brain-${Date.now()}`;

if (process.argv.includes("--help")) {
  printHelp();
  process.exit(0);
}

try {
  assertConfig();
  step("Auth target", `${repo.owner}/${repo.name} via ${baseUrl}`);

  let brain = await ensureBrainMachine();
  brain = await ensureBrainRunning(brain);
  brain = (await verifyBrainRuntimeSelection()) ?? brain;
  await verifyBrainMachineImage();

  await verifyTerminalSession(brain, {
    command: markerWriteCommand(marker),
    expect: `KODY_LIVE_MARKER:${marker}`,
    label: "terminal websocket write/read",
  });
  await verifyTerminalStatus(brain);
  await verifyDisposableCheckpoint();
  if (allowBrainCheckpointMutation) {
    await verifyBrainCheckpointRoundTrip(brain);
  } else {
    step(
      "Brain checkpoint mutation skipped",
      "set KODY_LIVE_ALLOW_CHECKPOINT_MUTATION=1 to backup, mutate, verify, and restore it",
    );
  }

  if (!allowSave || !allowDestructive) {
    step(
      "Restore proof skipped",
      "set KODY_LIVE_ALLOW_SAVE=1 and KODY_LIVE_ALLOW_DESTRUCTIVE=1 to save, destroy, recreate, and verify",
    );
    finish();
    process.exit(0);
  }

  const savedImage = await saveBrainImage();
  await destroyBrain();
  brain = await applyBrainImage(savedImage.imageRef);
  await verifyTerminalSession(brain, {
    command: markerReadCommand(),
    expect: `KODY_LIVE_MARKER:${marker}`,
    label: "restored image marker",
  });

  finish();
} catch (err) {
  console.error(`\nFAIL ${redact(err instanceof Error ? err.message : err)}`);
  process.exit(1);
}

function env(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function truthy(name) {
  return /^(1|true|yes)$/i.test(env(name) ?? "");
}

function assertConfig() {
  const missing = [];
  if (!token) {
    missing.push(
      "KODY_LIVE_GITHUB_TOKEN, E2E_GITHUB_TOKEN, GITHUB_TOKEN, KODY_BOT_TOKEN, or GH_TOKEN",
    );
  }
  if (!repo) {
    missing.push(
      "KODY_LIVE_REPO_SLUG=owner/repo, or KODY_LIVE_OWNER + KODY_LIVE_REPO",
    );
  }
  if (missing.length) {
    throw new Error(`Missing live verifier config: ${missing.join("; ")}`);
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid KODY_LIVE_BASE_URL: ${baseUrl}`);
  }
}

function resolveRepo() {
  const slug =
    env("KODY_LIVE_REPO_SLUG") ??
    env("KODY_REPO_SLUG") ??
    slugFromUrl(env("KODY_LIVE_REPO_URL"));
  if (slug) {
    const [owner, name] = slug.split("/");
    if (owner && name) return { owner, name };
  }
  const owner = env("KODY_LIVE_OWNER") ?? env("KODY_OWNER");
  const name = env("KODY_LIVE_REPO") ?? env("KODY_REPO");
  if (owner && name) return { owner, name };
  return null;
}

function slugFromUrl(raw) {
  if (!raw) return undefined;
  const match = raw.match(/github\.com[:/]+([^/\s]+)\/([^/\s.]+)(?:\.git)?/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function authHeaders() {
  return {
    "content-type": "application/json",
    "x-kody-token": token,
    "x-kody-owner": repo.owner,
    "x-kody-repo": repo.name,
    ...(env("KODY_LIVE_USER_LOGIN")
      ? { "x-kody-user-login": env("KODY_LIVE_USER_LOGIN") }
      : {}),
    ...(env("KODY_LIVE_STORE_REPO_URL")
      ? { "x-kody-store-repo-url": env("KODY_LIVE_STORE_REPO_URL") }
      : {}),
    ...(env("KODY_LIVE_STORE_REF")
      ? { "x-kody-store-ref": env("KODY_LIVE_STORE_REF") }
      : {}),
  };
}

async function api(method, path, body, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const url = new URL(path, baseUrl);
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    const message = data?.message ?? data?.error ?? text ?? res.statusText;
    const err = new Error(
      `${method} ${url.pathname} failed (${res.status}): ${message}`,
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function parseJson(text) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function brainStatus() {
  return api("GET", "/api/kody/brain/status", undefined, {
    timeoutMs: 120_000,
  });
}

async function ensureBrainMachine() {
  let status = await brainStatus();
  assertBrainStatusUsable(status, "Brain status");
  if (status.app && status.machineId) {
    step("Brain found", `${status.app}/${status.machineId} (${status.state})`);
    return status;
  }
  if (!allowProvision) {
    throw new Error(
      `No Brain machine found. Set KODY_LIVE_ALLOW_PROVISION=1 to create one for the live verifier. Current state: ${JSON.stringify(status)}`,
    );
  }

  step("Provisioning Brain", "no existing Brain machine was found");
  await api("POST", "/api/kody/brain/provision", {}, { timeoutMs: 180_000 });
  status = await waitForBrain(
    (next) => next.app && next.machineId,
    "Brain machine to exist",
    12 * 60_000,
  );
  step("Brain provisioned", `${status.app}/${status.machineId} (${status.state})`);
  return status;
}

function assertBrainStatusUsable(status, label) {
  if (status?.reason === "fly_access_denied") {
    throw new Error(
      `${label}: Fly token cannot access stored Brain app ${status.app ?? status.stored?.appName ?? "unknown"}. Update the repo vault FLY_API_TOKEN or run the verifier with a matching Fly token before testing terminal/image flows.`,
    );
  }
}

async function ensureBrainRunning(status) {
  if (status.state === "running") return status;
  step("Resuming Brain", `${status.app}/${status.machineId} is ${status.state}`);
  await api("POST", "/api/kody/brain/resume", {}, { timeoutMs: 180_000 });
  const running = await waitForBrain(
    (next) => next.app && next.machineId && next.state === "running",
    "Brain to be running",
    8 * 60_000,
  );
  step("Brain running", `${running.app}/${running.machineId}`);
  return running;
}

async function waitForBrain(predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await brainStatus();
    assertBrainStatusUsable(last, label);
    if (predicate(last)) return last;
    await sleep(5_000);
  }
  throw new Error(`Timed out waiting for ${label}. Last status: ${JSON.stringify(last)}`);
}

function brainTransport(status) {
  return {
    type: "fly",
    app: status.app,
    machineId: status.machineId,
    label: "Brain server",
    feature: "brain",
  };
}

async function brainImageState() {
  return api("GET", "/api/kody/brain/image", undefined, {
    timeoutMs: 120_000,
  });
}

async function verifyBrainRuntimeSelection() {
  const image = await brainImageState();
  if (image.imageRef && image.imageRef !== image.runningImageRef) {
    if (allowApply) {
      step(
        "Brain runtime mismatch",
        `applying selected ${image.imageRef}; currently running ${image.runningImageRef ?? "none"}`,
      );
      return applyBrainImage(image.imageRef);
    }
    throw new Error(
      `Selected Brain image is not applied. Re-run with KODY_LIVE_ALLOW_APPLY=1 to apply it before terminal verification. Selected=${image.imageRef} running=${image.runningImageRef ?? "none"}`,
    );
  }
  if (image.runningImageRef && (!image.runningApp || !image.runningMachineId)) {
    throw new Error(
      `Brain runtime state has a running image without app/machine: ${JSON.stringify(image)}`,
    );
  }
  if (image.runningImageRef) {
    step(
      "Brain runtime state",
      `${image.runningImageRef} on ${image.runningApp}/${image.runningMachineId}`,
    );
    return;
  }
  step(
    "Brain runtime state",
    "no applied image recorded; semantic terminal route must still resolve a live Brain or fail clearly",
  );
}

async function verifyBrainMachineImage() {
  const image = await brainImageState();
  if (!image.runningImageRef) {
    step("Brain machine image", "skipped because no applied image is recorded");
    return;
  }
  if (!image.runningApp || !image.runningMachineId) {
    throw new Error(
      `Applied Brain image is missing app/machine: ${JSON.stringify(image)}`,
    );
  }
  if (!image.machineImageRef) {
    throw new Error(
      `Applied Brain image has no live Fly machine image proof: ${JSON.stringify(image)}`,
    );
  }

  const expectedRuntimeRef = runtimeImageRef(
    image.runningApp,
    image.runningImageRef,
  );
  if (
    !sameImageRepoTag(image.machineImageRef, expectedRuntimeRef) &&
    !sameImageRepoTag(image.machineImageRef, image.runningImageRef)
  ) {
    throw new Error(
      `Fly machine image does not match applied Brain image. Applied=${image.runningImageRef} expectedRuntime=${expectedRuntimeRef} machine=${image.machineImageRef}`,
    );
  }
  step(
    "Brain machine image",
    `${image.machineImageRef} matches applied ${image.runningImageRef}`,
  );
}

function runtimeImageRef(app, sourceImageRef) {
  const withoutDigest = sourceImageRef.split("@")[0] ?? sourceImageRef;
  const marker = withoutDigest.lastIndexOf(":");
  const tag = marker === -1 ? "latest" : withoutDigest.slice(marker + 1);
  return `registry.fly.io/${app}:${tag}`;
}

function sameImageRepoTag(a, b) {
  const clean = (value) => String(value).split("@")[0];
  return clean(a) === clean(b);
}

async function terminalSession(status, resetSession = false) {
  const deadline = Date.now() + 3 * 60_000;
  let lastErr = null;
  let session = null;
  while (Date.now() < deadline) {
    try {
      session = await api(
        "POST",
        "/api/kody/terminal/session",
        {
          target: "brain",
          chatSessionId,
          resetSession,
          cols: 120,
          rows: 36,
        },
        { timeoutMs: 180_000 },
      );
      break;
    } catch (err) {
      lastErr = err;
      if (err?.status !== 409) throw err;
      step("Terminal waiting", "machine is still waking");
      await sleep(5_000);
    }
  }
  if (!session) throw lastErr ?? new Error("Terminal session did not start");
  if (!session.webSocketUrl) {
    throw new Error(`Terminal session did not return webSocketUrl: ${JSON.stringify(session)}`);
  }
  return session;
}

async function verifyTerminalSession(status, { command, expect, label }) {
  step("Terminal session", label);
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const session = await terminalSession(status, true);
    try {
      await runTerminalCommand(session.webSocketUrl, command, expect, 120_000);
      step("Terminal verified", label);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt >= 5 || !isRetryableTerminalError(err)) throw err;
      step(
        "Terminal waiting",
        `retrying after transient tunnel error: ${err.message}`,
      );
      await sleep(5_000);
    }
  }
  throw lastErr ?? new Error("Terminal verification did not run");
}

function isRetryableTerminalError(err) {
  const message = err instanceof Error ? err.message : String(err);
  return /tunnel|broken pipe|websocket closed|closed before expected output|machine is still waking/i.test(
    message,
  );
}

async function verifyTerminalStatus(status) {
  const result = await api(
    "POST",
    "/api/kody/terminal/status",
    {
      target: "brain",
      chatSessionId,
    },
    { timeoutMs: 60_000 },
  );
  if (result.ok !== true || typeof result.alive !== "boolean") {
    throw new Error(`Unexpected terminal status response: ${JSON.stringify(result)}`);
  }
  step("Terminal status", `alive=${result.alive}`);
}

async function runTerminalCommand(webSocketUrl, command, expect, timeoutMs) {
  if (typeof WebSocket === "undefined") {
    throw new Error("Node WebSocket is unavailable. Run the verifier with Node 22+.");
  }

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    let output = "";
    let sent = false;
    let done = false;
    const timeout = setTimeout(() => {
      rejectOnce(
        new Error(
          `Timed out waiting for terminal output ${JSON.stringify(expect)}. Output tail: ${JSON.stringify(
            stripAnsi(output).slice(-1200),
          )}`,
        ),
      );
    }, timeoutMs);

    function rejectOnce(err) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      tryClose(ws);
      reject(err);
    }

    function resolveOnce() {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      tryClose(ws);
      resolve();
    }

    function append(data) {
      output += data;
      if (output.length > 120_000) output = output.slice(-80_000);
      const clean = stripAnsi(output);
      if (clean.includes(expect)) {
        resolveOnce();
        return;
      }
      if (!sent && /(?:^|\r?\n)[^\r\n]*[#>$] $/.test(clean)) {
        setTimeout(sendCommand, 250);
      }
    }

    function sendCommand() {
      if (sent || ws.readyState !== WebSocket.OPEN) return;
      sent = true;
      ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 36 }));
      ws.send(JSON.stringify({ type: "input", data: `${command}\r` }));
    }

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "resize", cols: 120, rows: 36 }));
    });
    ws.addEventListener("message", (event) => {
      void messageDataToString(event.data)
        .then((raw) => {
          const message = parseJsonMessage(raw);
          if (!message) {
            append(raw);
            return;
          }
          if (message.type === "ready") {
            sendCommand();
            return;
          }
          if (message.type === "output" && typeof message.data === "string") {
            append(message.data);
            return;
          }
          if (message.type === "error") {
            rejectOnce(new Error(`Terminal bridge error: ${message.message ?? "unknown"}`));
          }
        })
        .catch(rejectOnce);
    });
    ws.addEventListener("error", () => {
      rejectOnce(new Error("Terminal websocket error"));
    });
    ws.addEventListener("close", () => {
      if (!done) {
        rejectOnce(
          new Error(
            `Terminal websocket closed before expected output. Output tail: ${JSON.stringify(
              stripAnsi(output).slice(-1200),
            )}`,
          ),
        );
      }
    });
  });
}

function parseJsonMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function messageDataToString(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
      "utf8",
    );
  }
  if (data && typeof data.text === "function") return data.text();
  return String(data);
}

function tryClose(ws) {
  try {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  } catch {
    // Best effort cleanup only.
  }
}

function markerWriteCommand(value) {
  return [
    `printf %s ${shellQuote(value)} > ${shellQuote(markerPath)}`,
    `printf '\\nKODY_LIVE_MARKER:'`,
    `cat ${shellQuote(markerPath)}`,
    `printf '\\n'`,
  ].join("; ");
}

function markerReadCommand() {
  return [
    `printf '\\nKODY_LIVE_MARKER:'`,
    `cat ${shellQuote(markerPath)} 2>/dev/null || true`,
    `printf '\\n'`,
  ].join("; ");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function stripAnsi(value) {
  return String(value).replace(
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    "",
  );
}

async function verifyDisposableCheckpoint() {
  const transport = { type: "local", label: "Kody live verifier" };
  const localSessionId = `${chatSessionId}-checkpoint`;
  const output = `checkpoint ${marker}`;
  await api("PUT", "/api/kody/chat/terminal/checkpoint", {
    transport,
    chatSessionId: localSessionId,
    cwd: "/tmp",
    shell: "/bin/sh",
    output,
  });
  await waitForCheckpointOutput(transport, localSessionId, output, "checkpoint");
  await deleteCheckpoint(transport, localSessionId);
  step("Checkpoint verified", "local disposable checkpoint round trip");
}

async function verifyBrainCheckpointRoundTrip(status) {
  const transport = brainTransport(status);
  const previous = await getCheckpoint(transport, chatSessionId);
  const output = `brain checkpoint ${marker}`;
  try {
    await api("PUT", "/api/kody/chat/terminal/checkpoint", {
      transport,
      chatSessionId,
      cwd: "/root",
      shell: "/bin/sh",
      output,
    });
    await waitForCheckpointOutput(transport, chatSessionId, output, "Brain checkpoint");
    step("Brain checkpoint verified", "backup, mutate, read");
  } finally {
    if (previous) {
      await api("PUT", "/api/kody/chat/terminal/checkpoint", {
        transport: previous.transport,
        chatSessionId: previous.chatSessionId,
        cwd: previous.cwd,
        shell: previous.shell,
        output: previous.output,
      }).catch((err) => {
        console.error(`WARN failed to restore previous Brain checkpoint: ${err.message}`);
      });
    } else {
      await deleteCheckpoint(transport, chatSessionId).catch((err) => {
        console.error(`WARN failed to delete test Brain checkpoint: ${err.message}`);
      });
    }
  }
}

async function getCheckpoint(transport, sessionId) {
  const params = new URLSearchParams({
    chatSessionId: sessionId,
    transport: JSON.stringify(transport),
  });
  const result = await api(
    "GET",
    `/api/kody/chat/terminal/checkpoint?${params}`,
    undefined,
  );
  return result.checkpoint ?? null;
}

async function waitForCheckpointOutput(transport, sessionId, output, label) {
  const deadline = Date.now() + 30_000;
  let last = null;
  while (Date.now() < deadline) {
    last = await getCheckpoint(transport, sessionId);
    if (last?.output === output) return last;
    await sleep(2_000);
  }
  throw new Error(`${label} round trip mismatch: ${JSON.stringify(last)}`);
}

async function deleteCheckpoint(transport, sessionId) {
  const params = new URLSearchParams({
    chatSessionId: sessionId,
    transport: JSON.stringify(transport),
  });
  await api("DELETE", `/api/kody/chat/terminal/checkpoint?${params}`, undefined);
}

async function saveBrainImage() {
  step("Saving Brain image", "starting GHCR image save job");
  const started = await api("POST", "/api/kody/brain/image", {}, {
    timeoutMs: 180_000,
  });
  if (!started.jobId) {
    throw new Error(`Brain image save did not return jobId: ${JSON.stringify(started)}`);
  }
  const timeoutMs = Number(env("KODY_LIVE_SAVE_TIMEOUT_MS") ?? 2 * 60 * 60_000);
  const deadline = Date.now() + timeoutMs;
  let last = started;
  while (Date.now() < deadline) {
    await sleep(10_000);
    try {
      last = await api(
        "GET",
        `/api/kody/brain/image?jobId=${encodeURIComponent(started.jobId)}`,
        undefined,
        { timeoutMs: 90_000 },
      );
    } catch (err) {
      if (err?.status === 404 && err?.data?.error === "job_not_found") {
        step("Brain image save pending", "save metadata not visible yet");
        continue;
      }
      if (err?.data?.status === "failed") {
        throw err;
      }
      if (err?.status >= 500) {
        step(
          "Brain image save pending",
          `transient poll error: ${err.data?.message ?? err.message}`,
        );
        continue;
      }
      throw err;
    }
    if (last.status === "completed" && last.imageRef) {
      step("Brain image saved", last.imageRef);
      return last;
    }
    if (last.status === "failed") {
      throw new Error(`Brain image save failed: ${last.message ?? JSON.stringify(last)}`);
    }
    step("Brain image save pending", last.status ?? "running");
  }
  throw new Error(`Timed out waiting for Brain image save. Last status: ${JSON.stringify(last)}`);
}

async function destroyBrain() {
  step("Destroying Brain", "destructive restore proof enabled");
  await api("POST", "/api/kody/brain/destroy", {}, { timeoutMs: 240_000 });
  await sleep(5_000);
}

async function applyBrainImage(imageRef) {
  step("Applying Brain image", imageRef);
  await api(
    "POST",
    "/api/kody/brain/image/apply",
    { imageRef },
    { timeoutMs: 15 * 60_000 },
  );
  const status = await waitForBrain(
    (next) => next.app && next.machineId && next.state === "running",
    "applied Brain to be running",
    15 * 60_000,
  );
  await verifyBrainRuntimeSelection();
  await verifyBrainMachineImage();
  step("Brain image applied", `${status.app}/${status.machineId}`);
  return status;
}

function step(name, detail) {
  console.log(`OK ${name}${detail ? `: ${redact(detail)}` : ""}`);
}

function finish() {
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\nPASS Brain live verifier completed in ${seconds}s`);
}

function redact(value) {
  let text = String(value);
  for (const secret of [token, env("KODY_LIVE_GITHUB_TOKEN"), env("GITHUB_TOKEN")]) {
    if (secret) text = text.split(secret).join("[redacted]");
  }
  return text;
}

function printHelp() {
  console.log(`
Usage:
  pnpm test:live:brain

Required:
  KODY_LIVE_GITHUB_TOKEN or E2E_GITHUB_TOKEN or GITHUB_TOKEN or KODY_BOT_TOKEN
  KODY_LIVE_REPO_SLUG=owner/repo

Optional:
  KODY_LIVE_BASE_URL=http://localhost:3333
  KODY_LIVE_STORE_REPO_URL=https://github.com/owner/state-repo
  KODY_LIVE_STORE_REF=main
  KODY_LIVE_ALLOW_PROVISION=1
  KODY_LIVE_ALLOW_APPLY=1
  KODY_LIVE_ALLOW_SAVE=1
  KODY_LIVE_ALLOW_DESTRUCTIVE=1
  KODY_LIVE_ALLOW_CHECKPOINT_MUTATION=1
  KODY_LIVE_SAVE_TIMEOUT_MS=7200000
`);
}
