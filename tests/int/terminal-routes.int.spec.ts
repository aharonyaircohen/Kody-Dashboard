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
        orgSlug: "personal",
      },
    ],
  })),
}));

const inventoryServer = vi.hoisted(() => ({
  emptyFlyInventory: vi.fn(() => ({ running: 0, total: 0, machines: [] })),
  refreshFlyInventoryCounts: vi.fn(
    (inv: { machines: Array<{ state?: string }> }) => ({
      machines: inv.machines,
      total: inv.machines.length,
      running: inv.machines.filter((machine) =>
        ["started", "running"].includes(String(machine.state)),
      ).length,
    }),
  ),
  appendSavedBrainMachineToInventory: vi.fn(async () => false),
  resolveSavedBrainServiceForRequest: vi.fn(async () => null),
  applySavedBrainMachineToInventory: vi.fn(
    (
      inv: { machines: Array<Record<string, unknown>> },
      brain: {
        app: string;
        orgSlug: string;
        stored?: unknown;
        machine?: Record<string, unknown>;
      },
    ) => {
      if (!brain.machine) {
        if (brain.stored) {
          inv.machines = inv.machines.filter(
            (machine) =>
              machine.feature !== "brain" && machine.app !== brain.app,
          );
        }
        return false;
      }
      inv.machines = inv.machines.filter(
        (machine) =>
          machine.feature !== "brain" && machine.app !== brain.app,
      );
      inv.machines.push({ ...brain.machine, orgSlug: brain.orgSlug });
      return true;
    },
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

const brainStore = vi.hoisted(() => ({
  readBrainImage: vi.fn(async (): Promise<unknown> => null),
  writeBrainApp: vi.fn(async () => undefined),
}));

const runtimeManager = vi.hoisted(() => ({
  readBrainRuntimeView: vi.fn(
    async (): Promise<Record<string, unknown>> => ({ source: "empty" }),
  ),
}));

const brainService = vi.hoisted(() => ({
  resolveBrainService: vi.fn(async () => ({
    app: "kody-brain-octocat",
    orgSlug: "personal",
    defaultRegion: "fra",
    stored: { app: "kody-brain-octocat", orgSlug: "personal" },
    state: "running",
    url: "https://kody-brain-octocat.fly.dev",
    machineId: "brain-1",
    machineImageRef: "registry.fly.io/kody-brain-octocat:running",
    machine: {
      feature: "brain",
      app: "kody-brain-octocat",
      machineId: "brain-1",
      state: "started",
      region: "fra",
      label: "kody-brain-octocat",
      sizeLabel: "perf 1x",
      orgSlug: "personal",
    },
  })),
}));

const brainFly = vi.hoisted(() => ({
  provisionBrain: vi.fn(async () => ({
    app: "kody-brain-octocat",
    url: "https://kody-brain-octocat.fly.dev",
    apiKey: "brain-key",
    machineId: "brain-restored",
    region: "fra",
    org: "personal",
  })),
}));

const imageRuntime = vi.hoisted(() => ({
  brainFlyRuntimeImageRef: vi.fn(
    ({ app, imageRef }: { app: string; imageRef: string }) =>
      `registry.fly.io/${app}:${imageRef.split(":").at(-1)}`,
  ),
  brainGhcrAuth: vi.fn(() => ({ token: "ghcr-token", user: "octocat" })),
  prepareBrainRuntimeImage: vi.fn(
    async () => "registry.fly.io/kody-brain-octocat:selected",
  ),
}));

vi.mock("@dashboard/lib/auth", () => auth);
vi.mock("@dashboard/lib/previews/config", () => previews);
vi.mock("@dashboard/lib/runners/fly-context", () => flyContext);
vi.mock("@dashboard/lib/runners/fly-inventory", () => inventory);
vi.mock("@dashboard/lib/runners/fly-inventory-server", () => inventoryServer);
vi.mock("@dashboard/lib/runners/brain-fly", () => brainFly);
vi.mock("@dashboard/lib/brain/store", () => brainStore);
vi.mock("@dashboard/lib/brain/runtime-manager", () => runtimeManager);
vi.mock("@dashboard/lib/brain/service-resolver", () => brainService);
vi.mock("@dashboard/lib/brain/image-runtime", () => imageRuntime);
vi.mock("@dashboard/lib/previews/fly-previews", () => flyPreview);
vi.mock("@dashboard/lib/terminal/bridge-fly", () => bridge);
vi.mock("@dashboard/lib/terminal/terminal-token", () => token);
vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));
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

function mockResolvedBrain(app: string, machineId: string, orgSlug: string) {
  brainService.resolveBrainService.mockResolvedValueOnce({
    app,
    orgSlug,
    defaultRegion: "fra",
    stored: { app, orgSlug },
    state: "running",
    url: `https://${app}.fly.dev`,
    machineId,
    machineImageRef: `registry.fly.io/${app}:running`,
    machine: {
      feature: "brain",
      app,
      machineId,
      state: "started",
      region: "fra",
      label: app,
      sizeLabel: "perf 1x",
      orgSlug,
    },
  });
}

function savedBrainResolution(
  app: string,
  machineId: string,
  orgSlug: string,
  state = "started",
  flyToken = "fly-token",
) {
  return {
    flyToken,
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
    brain: {
      app,
      orgSlug,
      defaultRegion: "fra",
      stored: { app, orgSlug },
      state,
      url: `https://${app}.fly.dev`,
      machineId,
      machineImageRef: `registry.fly.io/${app}:running`,
      machine: {
        feature: "brain",
        app,
        machineId,
        state,
        region: "fra",
        label: app,
        sizeLabel: "perf 1x",
        orgSlug,
      },
    },
  };
}

function mockSavedBrainInventory(
  app: string,
  machineId: string,
  orgSlug: string,
  state = "started",
  flyToken = "fly-token",
) {
  inventoryServer.resolveSavedBrainServiceForRequest.mockResolvedValueOnce(
    savedBrainResolution(app, machineId, orgSlug, state, flyToken) as never,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
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
  flyContext.flyConfigFromContext.mockImplementation(
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
  );
  inventory.listFlyInventory.mockResolvedValue({
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
        orgSlug: "personal",
      },
    ],
  });
  inventoryServer.emptyFlyInventory.mockReturnValue({
    running: 0,
    total: 0,
    machines: [],
  });
  inventoryServer.refreshFlyInventoryCounts.mockImplementation(
    (inv: { machines: Array<{ state?: string }> }) => ({
      machines: inv.machines,
      total: inv.machines.length,
      running: inv.machines.filter((machine) =>
        ["started", "running"].includes(String(machine.state)),
      ).length,
    }),
  );
  inventoryServer.appendSavedBrainMachineToInventory.mockResolvedValue(false);
  inventoryServer.resolveSavedBrainServiceForRequest.mockResolvedValue(null);
  inventoryServer.applySavedBrainMachineToInventory.mockImplementation(
    (
      inv: { machines: Array<Record<string, unknown>> },
      brain: {
        app: string;
        orgSlug: string;
        stored?: unknown;
        machine?: Record<string, unknown>;
      },
    ) => {
      if (!brain.machine) {
        if (brain.stored) {
          inv.machines = inv.machines.filter(
            (machine) =>
              machine.feature !== "brain" && machine.app !== brain.app,
          );
        }
        return false;
      }
      inv.machines = inv.machines.filter(
        (machine) =>
          machine.feature !== "brain" && machine.app !== brain.app,
      );
      inv.machines.push({ ...brain.machine, orgSlug: brain.orgSlug });
      return true;
    },
  );
  flyPreview.startMachine.mockResolvedValue(undefined);
  bridge.ensureTerminalBridge.mockResolvedValue({
    app: "kody-terminal",
    url: "https://bridge.example/ws",
    machineId: "bridge-1",
    secret: "bridge-secret",
  });
  bridge.findTerminalBridge.mockResolvedValue({
    app: "kody-terminal",
    url: "https://bridge.example",
    machineId: "bridge-1",
    secret: "bridge-secret",
  });
  token.mintTerminalBridgeToken.mockReturnValue("opaque-token");
  brainStore.readBrainImage.mockResolvedValue(null);
  runtimeManager.readBrainRuntimeView.mockResolvedValue({ source: "empty" });
  brainService.resolveBrainService.mockResolvedValue({
    app: "kody-brain-octocat",
    orgSlug: "personal",
    defaultRegion: "fra",
    stored: { app: "kody-brain-octocat", orgSlug: "personal" },
    state: "running",
    url: "https://kody-brain-octocat.fly.dev",
    machineId: "brain-1",
    machineImageRef: "registry.fly.io/kody-brain-octocat:running",
    machine: {
      feature: "brain",
      app: "kody-brain-octocat",
      machineId: "brain-1",
      state: "started",
      region: "fra",
      label: "kody-brain-octocat",
      sizeLabel: "perf 1x",
      orgSlug: "personal",
    },
  });
  brainStore.writeBrainApp.mockResolvedValue(undefined);
  brainFly.provisionBrain.mockResolvedValue({
    app: "kody-brain-octocat",
    url: "https://kody-brain-octocat.fly.dev",
    apiKey: "brain-key",
    machineId: "brain-restored",
    region: "fra",
    org: "personal",
  });
  imageRuntime.prepareBrainRuntimeImage.mockResolvedValue(
    "registry.fly.io/kody-brain-octocat:selected",
  );
});

afterEach(() => {
  vi.useRealTimers();
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
        orgSlug: "personal",
        secret: "bridge-secret",
      }),
    );
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
  });

  it("connects with a warning when the selected Brain image has not been applied", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      source: "runtime",
    });

    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-1",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      warnings: [
        expect.objectContaining({
          code: "selected_image_not_running",
          desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
        }),
      ],
    });
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
    expect(bridge.ensureTerminalBridge).toHaveBeenCalled();
  });

  it("does not let stale image metadata choose the terminal target", async () => {
    mockSavedBrainInventory("kody-brain-octocat", "brain-1", "personal");
    inventory.listFlyInventory.mockResolvedValueOnce({
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
          orgSlug: "personal",
        },
      ],
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      source: "runtime",
    });

    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-1",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "kody-brain-octocat",
      machineId: "brain-1",
      warnings: [
        expect.objectContaining({
          code: "selected_image_not_running",
        }),
      ],
    });
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
    expect(flyPreview.startMachine).not.toHaveBeenCalled();
  });

  it("connects when the selected Brain image is already running", async () => {
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningAt: "2026-07-02T00:00:00.000Z",
      runningApp: "kody-brain-octocat",
      runningMachineId: "brain-1",
      source: "runtime",
    });

    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-1",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "kody-brain-octocat",
      machineId: "brain-1",
    });
    expect(brainFly.provisionBrain).not.toHaveBeenCalled();
  });

  it("connects semantic Brain terminal requests through the recorded running machine", async () => {
    mockSavedBrainInventory("brain-1", "brain-current", "guy-koren");
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 1,
      total: 1,
      machines: [
        {
          feature: "brain",
          app: "brain-1",
          machineId: "brain-current",
          state: "started",
          region: "fra",
          label: "brain-1",
          sizeLabel: "perf 1x",
          orgSlug: "guy-koren",
        },
      ],
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningAt: "2026-07-02T00:00:00.000Z",
      runningApp: "brain-1",
      runningMachineId: "brain-current",
      source: "runtime",
    });

    const res = await sessionPOST(
      makeSessionReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "brain-1",
      machineId: "brain-current",
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "brain-1",
        machineId: "brain-current",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("does not fall back to broad Fly inventory for unresolved semantic Brain sessions", async () => {
    const res = await sessionPOST(
      makeSessionReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: "machine_not_found",
    });
    expect(inventory.listFlyInventory).not.toHaveBeenCalled();
    expect(bridge.ensureTerminalBridge).not.toHaveBeenCalled();
  });

  it("uses the recorded running Brain machine when the UI sends a stale Brain target", async () => {
    mockSavedBrainInventory("brain-1", "brain-current", "guy-koren");
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 2,
      total: 2,
      machines: [
        {
          feature: "brain",
          app: "kody-brain-octocat",
          machineId: "brain-old",
          state: "started",
          region: "fra",
          label: "old Brain",
          sizeLabel: "perf 1x",
          orgSlug: "personal",
        },
        {
          feature: "brain",
          app: "brain-1",
          machineId: "brain-current",
          state: "started",
          region: "fra",
          label: "brain-1",
          sizeLabel: "perf 1x",
          orgSlug: "guy-koren",
        },
      ],
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningAt: "2026-07-02T00:00:00.000Z",
      runningApp: "brain-1",
      runningMachineId: "brain-current",
      source: "runtime",
    });

    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-old",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "brain-1",
      machineId: "brain-current",
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "brain-1",
        machineId: "brain-current",
        orgSlug: "guy-koren",
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
          orgSlug: "personal",
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
    mockSavedBrainInventory("local-2", "brain-current", "guy-koren");

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
        orgSlug: "guy-koren",
      }),
    );
    expect(bridge.ensureTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "guy-koren" }),
    );
  });

  it("does not require broad Fly inventory for saved Brain terminal requests", async () => {
    mockSavedBrainInventory(
      "local-2",
      "brain-current",
      "guy-koren",
      "started",
      "env-fly-token",
    );

    const res = await sessionPOST(
      makeSessionReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(inventory.listFlyInventory).not.toHaveBeenCalled();
    expect(bridge.ensureTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "guy-koren",
        token: "env-fly-token",
      }),
    );
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "local-2",
        machineId: "brain-current",
        flyToken: "env-fly-token",
      }),
    );
  });

  it("maps stale Brain terminal requests to the resolved Brain machine", async () => {
    mockResolvedBrain("brain-1", "brain-current", "guy-koren");
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 1,
      total: 1,
      machines: [
        {
          feature: "brain",
          app: "kody-brain-octocat",
          machineId: "brain-old",
          state: "started",
          region: "fra",
          label: "kody-brain-octocat",
          sizeLabel: "perf 1x",
          orgSlug: "personal",
        },
      ],
    });
    mockSavedBrainInventory("brain-1", "brain-current", "guy-koren");

    const res = await sessionPOST(
      makeSessionReq({
        app: "kody-brain-octocat",
        machineId: "brain-old",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "brain-1",
      machineId: "brain-current",
    });
    expect(bridge.ensureTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "guy-koren" }),
    );
  });

  it("wakes saved Brain machines through their stored org and token", async () => {
    let started = false;
    flyPreview.startMachine.mockImplementationOnce(async () => {
      started = true;
    });
    inventory.listFlyInventory.mockImplementation(async () => ({
      running: 0,
      total: 0,
      machines: [],
    }));
    inventoryServer.resolveSavedBrainServiceForRequest.mockImplementation(
      async () =>
        savedBrainResolution(
          "local-2",
          "brain-current",
          "guy-koren",
          started ? "started" : "stopped",
          "env-fly-token",
        ) as never,
    );

    const res = await sessionPOST(
      makeSessionReq({
        app: "local-2",
        machineId: "brain-current",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(flyPreview.startMachine).toHaveBeenCalledWith(
      "local-2",
      "brain-current",
      expect.objectContaining({
        orgSlug: "guy-koren",
        token: "env-fly-token",
      }),
    );
    expect(bridge.ensureTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "guy-koren",
        token: "env-fly-token",
      }),
    );
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({ flyToken: "env-fly-token" }),
    );
  });

  it("uses an env Fly token for bridge provisioning and terminal access when the Brain token cannot manage apps", async () => {
    vi.stubEnv("FLY_API_TOKEN", "bridge-fly-token");
    mockSavedBrainInventory(
      "local-2",
      "brain-current",
      "guy-koren",
      "started",
      "brain-fly-token",
    );
    bridge.ensureTerminalBridge
      .mockRejectedValueOnce(
        new Error('Fly Machines API 403 on /apps: {"error":"unauthorized"}'),
      )
      .mockResolvedValueOnce({
        app: "kody-terminal",
        url: "https://bridge.example/ws",
        machineId: "bridge-1",
        secret: "bridge-secret",
      });

    const res = await sessionPOST(
      makeSessionReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(bridge.ensureTerminalBridge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ token: "brain-fly-token" }),
    );
    expect(bridge.ensureTerminalBridge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "bridge-fly-token" }),
    );
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({ flyToken: "bridge-fly-token" }),
    );
  });

  it("uses an env Fly token to wake the Brain when the Brain token cannot start machines", async () => {
    vi.stubEnv("FLY_API_TOKEN", "operator-fly-token");
    let started = false;
    flyPreview.startMachine
      .mockRejectedValueOnce(
        new Error('startMachine failed: 403 Forbidden — {"error":"unauthorized"}'),
      )
      .mockImplementationOnce(async () => {
        started = true;
      });
    inventory.listFlyInventory.mockImplementation(async () => ({
      running: 0,
      total: 0,
      machines: [],
    }));
    inventoryServer.resolveSavedBrainServiceForRequest.mockImplementation(
      async () =>
        savedBrainResolution(
          "local-2",
          "brain-current",
          "guy-koren",
          started ? "started" : "stopped",
          "brain-fly-token",
        ) as never,
    );

    const res = await sessionPOST(
      makeSessionReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(flyPreview.startMachine).toHaveBeenNthCalledWith(
      1,
      "local-2",
      "brain-current",
      expect.objectContaining({ token: "brain-fly-token" }),
    );
    expect(flyPreview.startMachine).toHaveBeenNthCalledWith(
      2,
      "local-2",
      "brain-current",
      expect.objectContaining({ token: "operator-fly-token" }),
    );
  });

  it("keeps waiting for a waking Brain machine before returning a terminal token", async () => {
    vi.useFakeTimers();
    let started = false;
    let postStartPolls = 0;
    flyPreview.startMachine.mockImplementationOnce(async () => {
      started = true;
    });
    inventory.listFlyInventory.mockImplementation(async () => ({
      running: 0,
      total: 0,
      machines: [],
    }));
    inventoryServer.resolveSavedBrainServiceForRequest.mockImplementation(
      async () => {
        const state = !started
          ? "stopped"
          : postStartPolls++ < 12
            ? "starting"
            : "started";
        return savedBrainResolution(
          "local-2",
          "brain-current",
          "guy-koren",
          state,
        ) as never;
      },
    );

    const pending = sessionPOST(
      makeSessionReq({
        app: "local-2",
        machineId: "brain-current",
        chatSessionId: "chat-1",
      }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      app: "local-2",
      machineId: "brain-current",
    });
    expect(postStartPolls).toBeGreaterThan(10);
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

  it("looks up status through the selected Brain org bridge", async () => {
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 0,
      total: 0,
      machines: [],
    });
    mockSavedBrainInventory(
      "local-2",
      "brain-current",
      "guy-koren",
      "started",
      "env-fly-token",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, alive: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await statusPOST(
      makeStatusReq({
        app: "local-2",
        machineId: "brain-current",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(bridge.findTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "guy-koren",
        token: "env-fly-token",
      }),
    );
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "guy-koren",
        flyToken: "env-fly-token",
      }),
    );
  });

  it("checks saved Brain status without broad Fly inventory", async () => {
    mockSavedBrainInventory(
      "local-2",
      "brain-current",
      "guy-koren",
      "started",
      "env-fly-token",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, alive: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await statusPOST(
      makeStatusReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(inventory.listFlyInventory).not.toHaveBeenCalled();
    expect(bridge.findTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        orgSlug: "guy-koren",
        token: "env-fly-token",
      }),
    );
  });

  it("uses an env Fly token for bridge status lookup and terminal claims when the Brain token cannot manage apps", async () => {
    vi.stubEnv("FLY_API_TOKEN", "bridge-fly-token");
    mockSavedBrainInventory(
      "local-2",
      "brain-current",
      "guy-koren",
      "started",
      "brain-fly-token",
    );
    bridge.findTerminalBridge
      .mockRejectedValueOnce(
        new Error('Fly Machines API 403 on /apps: {"error":"unauthorized"}'),
      )
      .mockResolvedValueOnce({
        app: "kody-terminal",
        url: "https://bridge.example",
        machineId: "bridge-1",
        secret: "bridge-secret",
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, alive: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await statusPOST(
      makeStatusReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(bridge.findTerminalBridge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ token: "brain-fly-token" }),
    );
    expect(bridge.findTerminalBridge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "bridge-fly-token" }),
    );
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({ flyToken: "bridge-fly-token" }),
    );
  });

  it("uses the recorded running Brain machine for stale Brain status checks", async () => {
    mockSavedBrainInventory("brain-1", "brain-current", "guy-koren");
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 2,
      total: 2,
      machines: [
        {
          feature: "brain",
          app: "kody-brain-octocat",
          machineId: "brain-old",
          state: "started",
          region: "fra",
          label: "old Brain",
          sizeLabel: "perf 1x",
          orgSlug: "personal",
        },
        {
          feature: "brain",
          app: "brain-1",
          machineId: "brain-current",
          state: "started",
          region: "fra",
          label: "brain-1",
          sizeLabel: "perf 1x",
          orgSlug: "guy-koren",
        },
      ],
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningAt: "2026-07-02T00:00:00.000Z",
      runningApp: "brain-1",
      runningMachineId: "brain-current",
      source: "runtime",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, alive: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await statusPOST(
      makeStatusReq({
        app: "kody-brain-octocat",
        machineId: "brain-old",
        feature: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, alive: true });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "brain-1",
        machineId: "brain-current",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("checks semantic Brain terminal status through the recorded running machine", async () => {
    mockSavedBrainInventory("brain-1", "brain-current", "guy-koren");
    inventory.listFlyInventory.mockResolvedValueOnce({
      running: 1,
      total: 1,
      machines: [
        {
          feature: "brain",
          app: "brain-1",
          machineId: "brain-current",
          state: "started",
          region: "fra",
          label: "brain-1",
          sizeLabel: "perf 1x",
          orgSlug: "guy-koren",
        },
      ],
    });
    runtimeManager.readBrainRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningImageRef: "ghcr.io/acme/kody-brain-octocat:selected",
      runningAt: "2026-07-02T00:00:00.000Z",
      runningApp: "brain-1",
      runningMachineId: "brain-current",
      source: "runtime",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, alive: true, ready: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const res = await statusPOST(
      makeStatusReq({
        target: "brain",
        chatSessionId: "chat-1",
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      alive: true,
      ready: true,
    });
    expect(token.mintTerminalBridgeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        app: "brain-1",
        machineId: "brain-current",
        orgSlug: "guy-koren",
      }),
    );
  });
});
