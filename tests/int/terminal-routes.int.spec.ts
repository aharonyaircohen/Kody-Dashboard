/**
 * @fileoverview Integration coverage for chat terminal Fly API routes.
 * @testFramework vitest
 * @domain terminal
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  })),
  getUserOctokit: vi.fn(async () => ({ rest: {} })),
}));

const previews = vi.hoisted(() => ({
  resolvePreviewConfigForOctokit: vi.fn(async () => ({
    token: "fly-token",
    orgSlug: "personal",
    defaultRegion: "fra",
  })),
}));

const flyContext = vi.hoisted(() => ({
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "ghp_test",
      octokit: { rest: {} },
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  })),
  flyConfigFromContext: vi.fn(
    (context: {
      flyToken?: string;
      flyOrgSlug: string;
      flyDefaultRegion: string;
    }) =>
      context.flyToken
        ? {
            token: context.flyToken,
            orgSlug: context.flyOrgSlug,
            defaultRegion: context.flyDefaultRegion,
          }
        : null,
  ),
}));

const inventory = vi.hoisted(() => ({
  listFlyInventory: vi.fn(async () => ({
    running: 1,
    total: 1,
    machines: [
      {
        feature: "brain",
        app: "kody-brain-octocat",
        machineId: "brain-1",
        state: "started",
        region: "fra",
        label: "kody-brain-octocat",
        sizeLabel: "perf 1x",
      },
    ],
  })),
}));

const inventoryServer = vi.hoisted(() => ({
  appendSavedBrainMachineToInventory: vi.fn(
    async (_req: unknown, _inv: { machines: Array<Record<string, unknown>> }) =>
      false,
  ),
}));

const flyPreview = vi.hoisted(() => ({
  startMachine: vi.fn(async () => {}),
}));

const bridge = vi.hoisted(() => ({
  ensureTerminalBridge: vi.fn(async () => ({
    app: "kody-terminal",
    url: "https://bridge.example/ws",
    machineId: "bridge-1",
    secret: "bridge-secret",
  })),
  findTerminalBridge: vi.fn(
    async (): Promise<{
      app: string;
      url: string;
      machineId: string;
      secret: string;
    } | null> => ({
      app: "kody-terminal",
      url: "https://bridge.example",
      machineId: "bridge-1",
      secret: "bridge-secret",
    }),
  ),
}));

const token = vi.hoisted(() => ({
  mintTerminalBridgeToken: vi.fn(() => "opaque-token"),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/previews/config", () => previews);
vi.mock("@dashboard/lib/runners/fly-context", () => flyContext);
vi.mock("@dashboard/lib/runners/fly-inventory", () => inventory);
vi.mock("@dashboard/lib/runners/fly-inventory-server", () => inventoryServer);
vi.mock("@dashboard/lib/previews/fly-previews", () => flyPreview);
vi.mock("@dashboard/lib/terminal/bridge-fly", () => bridge);
vi.mock("@dashboard/lib/terminal/terminal-token", () => token);
vi.mock("@dashboard/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { POST as sessionPOST } from "../../app/api/kody/terminal/session/route";
import { POST as statusPOST } from "../../app/api/kody/terminal/status/route";

function makeSessionReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/terminal/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeStatusReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/terminal/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  });
  auth.getUserOctokit.mockResolvedValue({ rest: {} });
  previews.resolvePreviewConfigForOctokit.mockResolvedValue({
    token: "fly-token",
    orgSlug: "personal",
    defaultRegion: "fra",
  });
  flyContext.resolveFlyContext.mockResolvedValue({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "ghp_test",
      octokit: { rest: {} },
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  });
  inventoryServer.appendSavedBrainMachineToInventory.mockResolvedValue(false);
  token.mintTerminalBridgeToken.mockReturnValue("opaque-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/kody/terminal/session", () => {
  it("mints a chat-scoped Brain terminal token", async () => {
    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-1",
        chatSessionId: "chat-1",
        resetSession: true,
        cols: 132,
        rows: 40,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "kody-brain-octocat",
      machineId: "brain-1",
      bridgeApp: "kody-terminal",
      webSocketUrl: "wss://bridge.example/ws?token=opaque-token",
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        app: "kody-brain-octocat",
        machineId: "brain-1",
        chatSessionId: "chat-1",
        resetSession: true,
        cols: 132,
        rows: 40,
        flyToken: "fly-token",
        secret: "bridge-secret",
      }),
    );
  });

  it("rejects non-terminal Fly machines", async () => {
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 1,
      total: 1,
      machines: [
        {
          feature: "preview",
          app: "preview-app",
          machineId: "preview-1",
          state: "started",
          region: "fra",
          label: "preview",
          sizeLabel: "shared",
        },
      ],
    });

    const res = await sessionPOST(
      makeSessionReq({ app: "preview-app", machineId: "preview-1" }),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "machine_not_terminal_capable",
    });
    expect(bridge.ensureTerminalBridge).not.toHaveBeenCalled();
  });

  it("uses the saved Brain fallback before selecting the terminal target", async () => {
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 0,
      total: 0,
      machines: [],
    });
    inventoryServer.appendSavedBrainMachineToInventory.mockImplementationOnce(
      async (
        _req: unknown,
        inv: { machines: Array<Record<string, unknown>> },
      ) => {
        inv.machines.push({
          feature: "brain",
          app: "local-2",
          machineId: "brain-current",
          state: "started",
          region: "fra",
          label: "local-2",
          sizeLabel: "perf 1x",
        });
        return true;
      },
    );

    const res = await sessionPOST(
      makeSessionReq({
        app: "local-2",
        machineId: "brain-stale",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "local-2",
      machineId: "brain-current",
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "local-2",
        machineId: "brain-current",
      }),
    );
  });
});

describe("POST /api/kody/terminal/status", () => {
  it("returns alive false without creating a bridge", async () => {
    bridge.findTerminalBridge.mockResolvedValueOnce(null);

    const res = await statusPOST(
      makeStatusReq({
        app: "kody-runner",
        machineId: "runner-1",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alive: false });
    expect(bridge.ensureTerminalBridge).not.toHaveBeenCalled();
  });

  it("proxies alive status from the bridge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(
          "https://bridge.example/status?token=opaque-token",
        );
        return new Response(
          JSON.stringify({
            ok: true,
            alive: true,
            ready: true,
            socketCount: 0,
            lastTouched: 123,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const res = await statusPOST(
      makeStatusReq({
        app: "kody-runner",
        machineId: "runner-1",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      alive: true,
      ready: true,
      socketCount: 0,
      lastTouched: 123,
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSessionId: "chat-1",
        ttlSeconds: 30,
      }),
    );
  });
});
