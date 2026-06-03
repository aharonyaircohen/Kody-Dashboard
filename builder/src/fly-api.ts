/**
 * Minimal Fly Machines REST + GraphQL client for the builder CLI.
 *
 * Builder runs inside a Fly Machine, so all of these calls are
 * Fly→Fly TLS — no Vercel→Fly hop. Idempotent operations re-run
 * cleanly on PR sync.
 */

const FLY_MACHINES_BASE = "https://api.machines.dev/v1";
const FLY_GRAPHQL = "https://api.fly.io/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

function authHeader(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function expectOk(res: Response, ctx: string): Promise<void> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `${ctx} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
    );
  }
}

export async function appExists(
  appName: string,
  token: string,
): Promise<boolean> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}`,
    {
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return false;
  await expectOk(res, "appExists");
  return true;
}

export async function createApp(
  appName: string,
  orgSlug: string,
  token: string,
): Promise<void> {
  const res = await fetch(`${FLY_MACHINES_BASE}/apps`, {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify({ app_name: appName, org_slug: orgSlug }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 422) return; // name taken — idempotent
  await expectOk(res, "createApp");
}

export async function allocateSharedIps(
  appName: string,
  token: string,
): Promise<void> {
  const mutation = `
    mutation AllocateIps($appId: ID!) {
      v4: allocateIpAddress(input: { appId: $appId, type: shared_v4 }) { ipAddress { address } }
      v6: allocateIpAddress(input: { appId: $appId, type: v6 }) { ipAddress { address } }
    }
  `;
  const res = await fetch(FLY_GRAPHQL, {
    method: "POST",
    headers: authHeader(token),
    body: JSON.stringify({ query: mutation, variables: { appId: appName } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await expectOk(res, "allocateSharedIps");
  const data = (await res.json()) as { errors?: Array<{ message: string }> };
  if (data.errors?.length) {
    const msgs = data.errors.map((e) => e.message).join("; ");
    if (!/already|exists/i.test(msgs))
      throw new Error(`allocateSharedIps: ${msgs}`);
  }
}

export async function listMachines(
  appName: string,
  token: string,
): Promise<Array<{ id: string; state: string }>> {
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines`,
    {
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return [];
  await expectOk(res, "listMachines");
  const data = (await res.json()) as Array<{ id: string; state: string }>;
  return data.map((m) => ({ id: m.id, state: m.state }));
}

export async function destroyMachine(
  appName: string,
  machineId: string,
  token: string,
): Promise<void> {
  await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}/stop`,
    {
      method: "POST",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => undefined);
  const res = await fetch(
    `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(appName)}/machines/${encodeURIComponent(machineId)}?force=true`,
    {
      method: "DELETE",
      headers: authHeader(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  if (res.status === 404) return;
  await expectOk(res, "destroyMachine");
}

export interface CreatePreviewMachineInput {
  appName: string;
  region: string;
  image: string;
  internalPort?: number;
  /** Runtime env (vault secrets) — needed for SSR pages that read
   *  DATABASE_URL, BLOB_READ_WRITE_TOKEN, etc. on each request. */
  env?: Record<string, string>;
}

export async function createPreviewMachine(
  input: CreatePreviewMachineInput,
  token: string,
): Promise<string> {
  const internalPort = input.internalPort ?? 8080;
  const body = {
    region: input.region,
    config: {
      image: input.image,
      env: input.env ?? {},
      auto_destroy: false,
      restart: { policy: "always" },
      // Dev mode (`next dev`) runs webpack at request time, which is
      // memory-hungry for heavy apps (A-Guy hung silently on 2 GB).
      // 4 GB / 2 CPU is the floor that compiles A-Guy-class pages
      // without OOM. Suspended state still costs ~$0.
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 4096 },
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
      // NO machine-level `checks` here on purpose. A periodic HTTP check
      // (we had GET / every 15s) issues a request to the machine forever,
      // so Fly never sees it as idle and `auto_stop_machines: "suspend"`
      // can never fire — every open-PR preview then runs 24/7 at 4 GB.
      // Previews don't need health gating: the Fly proxy routes on demand
      // and `auto_start_machines` wakes a suspended machine on the next
      // real request. A broken preview returns 5xx, which is acceptable
      // for a throwaway PR env. (Prod runs on Vercel, not here.)
    },
  };
  // Retry on MANIFEST_UNKNOWN — Fly's registry is eventually consistent
  // for ~5s after `flyctl deploy --push`.
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(
      `${FLY_MACHINES_BASE}/apps/${encodeURIComponent(input.appName)}/machines`,
      {
        method: "POST",
        headers: authHeader(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { id: string };
      return data.id;
    }
    const text = await res.text().catch(() => "");
    lastErr = new Error(
      `createPreviewMachine ${res.status}: ${text.slice(0, 400)}`,
    );
    if (!/MANIFEST_UNKNOWN|manifest unknown/i.test(text)) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw lastErr ?? new Error("createPreviewMachine failed (unknown)");
}
