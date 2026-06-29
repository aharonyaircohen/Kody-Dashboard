import { afterEach, describe, expect, it, vi } from "vitest";

import { createPreviewMachine } from "../../builder/src/fly-api";

interface CapturedRequest {
  config: {
    services?: Array<{ autostop?: unknown; autostart?: unknown }>;
  };
}

function mockCreateResponse(captured: CapturedRequest[]) {
  globalThis.fetch = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(JSON.parse(init?.body as string) as CapturedRequest);
      return new Response(JSON.stringify({ id: "m-builder-preview" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  ) as unknown as typeof fetch;
}

describe("builder createPreviewMachine autostop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows the final Fly machine create call more time than regular API reads", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createPreviewMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "registry.fly.io/kp-test-app:sha",
      },
      "fly-test-token",
    );

    expect(timeoutSpy).toHaveBeenCalledWith(180_000);
  });

  it("retries transient Fly timeouts while creating the preview machine", async () => {
    const captured: CapturedRequest[] = [];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 408 }))
      .mockImplementationOnce(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          captured.push(JSON.parse(init?.body as string) as CapturedRequest);
          return new Response(JSON.stringify({ id: "m-builder-preview" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      ) as unknown as typeof fetch;

    const id = await createPreviewMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "registry.fly.io/kp-test-app:sha",
      },
      "fly-test-token",
    );

    expect(id).toBe("m-builder-preview");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(captured[0].config).toMatchObject({
      image: "registry.fly.io/kp-test-app:sha",
    });
  });

  it("uses suspend for previews at or below Fly's 2 GB suspend limit", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createPreviewMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "registry.fly.io/kp-test-app:sha",
        memoryMb: 2048,
        idleSuspend: true,
      },
      "fly-test-token",
    );

    expect(captured[0].config.services?.[0]).toMatchObject({
      autostop: "suspend",
      autostart: true,
    });
  });

  it("stops oversized previews instead of asking Fly to suspend them", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createPreviewMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "registry.fly.io/kp-test-app:sha",
        memoryMb: 4096,
        idleSuspend: true,
      },
      "fly-test-token",
    );

    expect(captured[0].config.services?.[0]).toMatchObject({
      autostop: true,
      autostart: true,
    });
  });

  it("honors idleSuspend=false", async () => {
    const captured: CapturedRequest[] = [];
    mockCreateResponse(captured);

    await createPreviewMachine(
      {
        appName: "kp-test-app",
        region: "fra",
        image: "registry.fly.io/kp-test-app:sha",
        memoryMb: 2048,
        idleSuspend: false,
      },
      "fly-test-token",
    );

    expect(captured[0].config.services?.[0]?.autostop).toBe("off");
  });
});
