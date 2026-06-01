/**
 * @fileType library
 * @domain previews
 * @pattern fly-machines-client
 *
 * Fly Machines REST + GraphQL client for PR preview hosting.
 *
 * Separate from the runners' `fly.ts` because:
 *   - runners spawn one-shot machines that exit; previews are long-lived
 *     HTTP services that auto-suspend.
 *   - previews need app creation + IP allocation per PR (each preview is
 *     its own app, so it gets its own <app>.fly.dev hostname).
 *   - runners share one `kody-runner` app; previews can't.
 *
 * The pool path (see `pool-claim.ts`) skips most of this — it claims a
 * pre-booted suspended machine and only swaps the image.
 */

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const FLY_GRAPHQL = "https://api.fly.io/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

export interface FlyPreviewConfig {
  token: string;
  orgSlug: string;
  defaultRegion: string;
}

export interface CreatePreviewMachineInput {
  appName: string;
  region: string;
  image: string;
  env?: Record<string, string>;
  internalPort?: number;
  memoryMb?: number;
  cpus?: number;
  cpuKind?: "shared" | "performance";
  /**
   * Files written into the machine's filesystem at boot via Fly's
   * `config.files` (base64 `raw_value`). Lets us serve uploaded static
   * content from a stock image with no Docker build — see `static-preview.ts`.
   */
  files?: Array<{ guestPath: string; contentBase64: string }>;
}

export interface MachineInfo {
  id: string;
  state: string;
  region: string;
}

/**
 * Transient errors we see from Vercel→Fly: TLS handshake races,
 * ECONNRESET mid-request, and undici socket aborts. The Fly Machines API
 * is idempotent enough on GET + safe for short retries on POST/DELETE
 * (consumer-side dedup handles the rest), so backed-off retry keeps the
 * webhook flow from dying on a single network blip.
 */
function isTransientFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /socket|ECONNRESET|ENOTFOUND|ETIMEDOUT|TLS|EAI_AGAIN|fetch failed/i.test(
    msg,
  );
}

async function flyFetch(
  url: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(init.headers ?? {}),
  };
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetch(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      lastErr = err;
      if (!isTransientFetchError(err)) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr ?? new Error("flyFetch exhausted retries");
}

async function assertOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${context} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }
}

export async function appExists(
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<boolean> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}`,
    { method: "GET" },
    cfg.token,
  );
  if (res.status === 404) return false;
  await assertOk(res, "appExists");
  return true;
}

export async function createApp(
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<void> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps`,
    {
      method: "POST",
      body: JSON.stringify({
        app_name: appName,
        org_slug: cfg.orgSlug,
      }),
    },
    cfg.token,
  );
  if (res.status === 422) return; // name taken — idempotent
  await assertOk(res, "createApp");
}

/**
 * Allocate shared IPv4 + IPv6 via GraphQL. Required for the
 * auto-provisioned `<app>.fly.dev` hostname to answer HTTPS.
 * Shared v4 = free; dedicated v4 would be $2/mo and is unnecessary here.
 */
export async function allocateSharedIps(
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<void> {
  const mutation = `
    mutation AllocateIps($appId: ID!) {
      v4: allocateIpAddress(input: { appId: $appId, type: shared_v4 }) {
        ipAddress { address }
      }
      v6: allocateIpAddress(input: { appId: $appId, type: v6 }) {
        ipAddress { address }
      }
    }
  `;
  const res = await flyFetch(
    FLY_GRAPHQL,
    {
      method: "POST",
      body: JSON.stringify({ query: mutation, variables: { appId: appName } }),
    },
    cfg.token,
  );
  await assertOk(res, "allocateSharedIps");
  const data = (await res.json()) as { errors?: Array<{ message: string }> };
  if (data.errors && data.errors.length > 0) {
    const msgs = data.errors.map((e) => e.message).join("; ");
    if (!/already|exists/i.test(msgs)) {
      throw new Error(`allocateSharedIps failed: ${msgs}`);
    }
  }
}

export async function createMachine(
  input: CreatePreviewMachineInput,
  cfg: FlyPreviewConfig,
): Promise<MachineInfo> {
  const internalPort = input.internalPort ?? 8080;
  const body = {
    region: input.region,
    config: {
      image: input.image,
      env: input.env ?? {},
      auto_destroy: false,
      restart: { policy: "always" },
      ...(input.files && input.files.length > 0
        ? {
            files: input.files.map((f) => ({
              guest_path: f.guestPath,
              raw_value: f.contentBase64,
            })),
          }
        : {}),
      guest: {
        cpu_kind: input.cpuKind ?? "shared",
        cpus: input.cpus ?? 1,
        memory_mb: input.memoryMb ?? 512,
      },
      services: [
        {
          ports: [
            { port: 443, handlers: ["tls", "http"], force_https: false },
            { port: 80, handlers: ["http"] },
          ],
          protocol: "tcp",
          internal_port: internalPort,
          auto_stop_machines: "suspend",
          auto_start_machines: true,
          min_machines_running: 0,
        },
      ],
      checks: {
        httpget: {
          type: "http",
          port: internalPort,
          method: "GET",
          path: "/",
          interval: "15s",
          timeout: "10s",
          grace_period: "30s",
        },
      },
    },
  };

  // Fly's registry is eventually consistent: a freshly-pushed manifest
  // can return MANIFEST_UNKNOWN for a few seconds. Retry on that
  // specific class of error.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await flyFetch(
      `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(input.appName)}/machines`,
      { method: "POST", body: JSON.stringify(body) },
      cfg.token,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        id: string;
        state: string;
        region: string;
      };
      return { id: data.id, state: data.state, region: data.region };
    }
    const text = await res.text().catch(() => "");
    const isManifestRace = /MANIFEST_UNKNOWN|manifest unknown/i.test(text);
    lastErr = new Error(
      `createMachine failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
    if (!isManifestRace) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr ?? new Error("createMachine failed (unknown)");
}

export async function waitForMachineStarted(
  appName: string,
  machineId: string,
  cfg: FlyPreviewConfig,
  timeoutMs = 60_000,
): Promise<void> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/wait?state=started&timeout=${Math.floor(timeoutMs / 1000)}`,
    { method: "GET" },
    cfg.token,
  );
  await assertOk(res, "waitForMachineStarted");
}

export async function listMachines(
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<MachineInfo[]> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines`,
    { method: "GET" },
    cfg.token,
  );
  if (res.status === 404) return [];
  await assertOk(res, "listMachines");
  const data = (await res.json()) as Array<{
    id: string;
    state: string;
    region: string;
  }>;
  return data.map((m) => ({ id: m.id, state: m.state, region: m.region }));
}

export async function destroyMachine(
  appName: string,
  machineId: string,
  cfg: FlyPreviewConfig,
): Promise<void> {
  // Stop first (Fly requires `force=true` to destroy a started machine in
  // one call; using stop+destroy is more predictable).
  await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/stop`,
    { method: "POST" },
    cfg.token,
  ).catch(() => undefined);
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
    { method: "DELETE" },
    cfg.token,
  );
  if (res.status === 404) return;
  await assertOk(res, "destroyMachine");
}

export async function destroyApp(
  appName: string,
  cfg: FlyPreviewConfig,
): Promise<void> {
  const res = await flyFetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}`,
    { method: "DELETE" },
    cfg.token,
  );
  if (res.status === 404) return;
  await assertOk(res, "destroyApp");
}

export function flyHostname(appName: string): string {
  return `https://${appName}.fly.dev`;
}
