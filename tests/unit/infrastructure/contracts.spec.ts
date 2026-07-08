import { describe, expect, it } from "vitest";
import type {
  BrowserProvider,
  DeploymentProvider,
  ServerContextBase,
  InfrastructureProviderSelection,
  ServerProvider,
} from "@dashboard/lib/infrastructure/contracts";

describe("infrastructure contracts", () => {
  it("model Kody infrastructure as servers, deployments, and browsers", () => {
    const server = {
      id: "provider-a",
      area: "servers",
      capabilities: new Set(["run-work"]),
      run: async () => ({ machineId: "m-1" }),
    } satisfies ServerProvider<ServerContextBase, unknown, unknown>;

    const deployment = {
      id: "provider-a",
      area: "deployments",
      capabilities: new Set(["deploy-preview"]),
      create: async () => ({ state: "pending" }),
      get: async () => null,
      destroy: async () => undefined,
    } satisfies DeploymentProvider<unknown, unknown, unknown, unknown>;

    const browser = {
      id: "provider-a",
      area: "browsers",
      capabilities: new Set(["real-browser"]),
      createSession: async () => ({ id: "s1" }),
      act: async () => ({ ok: true }),
      closeSession: async () => undefined,
    } satisfies BrowserProvider<unknown, unknown, unknown, unknown>;

    expect([server.area, deployment.area, browser.area]).toEqual([
      "servers",
      "deployments",
      "browsers",
    ]);
  });

  it("does not restrict provider ids to one vendor", () => {
    const selection = {
      servers: "provider-a",
      deployments: "provider-b",
      browsers: "provider-c",
    } satisfies InfrastructureProviderSelection;

    expect(selection).toEqual({
      servers: "provider-a",
      deployments: "provider-b",
      browsers: "provider-c",
    });
  });
});
