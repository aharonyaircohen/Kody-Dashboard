/**
 * Unit tests for the Wake Lock utility (src/dashboard/lib/wake-lock.ts).
 *
 * Tests that the Wake Lock API is acquired when supported and released
 * properly, with proper fallback when unsupported.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requestWakeLock, releaseWakeLock } from "@dashboard/lib/wake-lock";

describe("requestWakeLock", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns null when navigator is undefined (SSR guard)", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const result = await requestWakeLock();
    expect(result).toBeNull();
  });

  it("returns null when wakeLock is not supported", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      writable: true,
      configurable: true,
    });
    const result = await requestWakeLock();
    expect(result).toBeNull();
  });

  it("returns a WakeLockSentinel when wakeLock.request succeeds", async () => {
    const sentinel = { released: false, release: vi.fn() };
    const requestMock = vi.fn().mockResolvedValue(sentinel);
    Object.defineProperty(globalThis, "navigator", {
      value: { wakeLock: { request: requestMock } },
      writable: true,
      configurable: true,
    });

    const result = await requestWakeLock();

    expect(result).toBe(sentinel);
    expect(requestMock).toHaveBeenCalledWith("screen");
  });

  it("returns null when wakeLock.request throws", async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error("Not allowed"));
    Object.defineProperty(globalThis, "navigator", {
      value: { wakeLock: { request: requestMock } },
      writable: true,
      configurable: true,
    });

    const result = await requestWakeLock();

    expect(result).toBeNull();
  });
});

describe("releaseWakeLock", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when sentinel is null", async () => {
    await releaseWakeLock(null);
    // Should not throw.
  });

  it("calls release on the sentinel", async () => {
    const releaseMock = vi.fn();
    const sentinel = {
      released: false,
      release: releaseMock,
    } as unknown as WakeLockSentinel;

    await releaseWakeLock(sentinel);

    expect(releaseMock).toHaveBeenCalled();
  });

  it("does not throw if release throws", async () => {
    const releaseMock = vi
      .fn()
      .mockRejectedValue(new Error("Already released"));
    const sentinel = {
      released: false,
      release: releaseMock,
    } as unknown as WakeLockSentinel;

    // Should not throw.
    await releaseWakeLock(sentinel);
  });
});
