/**
 * @fileType utility
 * @domain terminal
 * @pattern terminal-bridge-exec-client
 *
 * Small HTTP client for authenticated one-shot bridge commands.
 */

function bridgeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function runTerminalBridgeLocalExec(input: {
  bridgeUrl: string;
  token: string;
  command: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const res = await fetch(`${bridgeBaseUrl(input.bridgeUrl)}/exec`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      command: input.command,
      local: true,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    code?: number;
    stdout?: string;
    stderr?: string;
    error?: string;
  };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? `Bridge command failed (HTTP ${res.status})`);
  }
  const code = body.code ?? 0;
  const stdout = body.stdout ?? "";
  const stderr = body.stderr ?? "";
  if (code !== 0) {
    throw new Error(`Bridge command failed with exit ${code}: ${stderr}`);
  }
  return { code, stdout, stderr };
}

export interface TerminalBridgeExecJob {
  id: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export async function startTerminalBridgeLocalExecJob(input: {
  bridgeUrl: string;
  token: string;
  command: string;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<TerminalBridgeExecJob> {
  const res = await fetch(`${bridgeBaseUrl(input.bridgeUrl)}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({
      command: input.command,
      local: true,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    job?: TerminalBridgeExecJob;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.job) {
    throw new Error(
      body.error ?? `Bridge job start failed (HTTP ${res.status})`,
    );
  }
  return body.job;
}

export async function getTerminalBridgeExecJob(input: {
  bridgeUrl: string;
  token: string;
  jobId: string;
}): Promise<TerminalBridgeExecJob> {
  const res = await fetch(
    `${bridgeBaseUrl(input.bridgeUrl)}/jobs/${encodeURIComponent(input.jobId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
      },
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    job?: TerminalBridgeExecJob;
    error?: string;
  };
  if (!res.ok || !body.ok || !body.job) {
    throw new Error(
      body.error ?? `Bridge job read failed (HTTP ${res.status})`,
    );
  }
  return body.job;
}
