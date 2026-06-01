/**
 * Unit tests for Wake Lock integration in useVoiceChat.
 *
 * Verifies that navigator.wakeLock is acquired when a voice conversation
 * starts and released when it stops/pauses/interrupts/unmounts.
 *
 * @testFramework vitest
 * @domain voice-chat
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// Mock the browser Wake Lock API before importing the hook
class FakeWakeLockSentinel {
  released = false;
  async release() {
    this.released = true;
  }
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const mockWakeLockRequest = vi.fn(() =>
  Promise.resolve(new FakeWakeLockSentinel()),
);

vi.stubGlobal("navigator", {
  wakeLock: {
    request: mockWakeLockRequest,
  },
} as unknown as Navigator);

// Mock the speech recognition and TTS hooks so we can isolate wake-lock behavior
vi.mock("@dashboard/lib/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: vi.fn(() => ({
    isSupported: true,
    isListening: false,
    transcript: "",
    start: vi.fn(),
    stop: vi.fn(),
    error: null,
  })),
}));

vi.mock("@dashboard/lib/hooks/useKodyTTSPiper", () => ({
  useKodyTTSPiper: vi.fn(() => ({
    isSupported: true,
    engine: "browser" as const,
    engineError: null,
    enqueue: vi.fn(),
    cancel: vi.fn(),
    finish: vi.fn(),
    unlock: vi.fn(),
  })),
}));

import { useVoiceChat } from "@dashboard/lib/hooks/useVoiceChat";

describe("Wake Lock — useVoiceChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("acquires wake lock when startConversation is called", async () => {
    const { result } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    expect(mockWakeLockRequest).toHaveBeenCalledWith("screen");
  });

  it("releases wake lock when stopConversation is called", async () => {
    const { result } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.stopConversation();
    });

    // After stop, request should not be called again
    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);
  });

  it("releases wake lock when pauseConversation is called", async () => {
    const { result } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.pauseConversation();
    });

    // Wake lock should have been released
    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);
  });

  it("releases wake lock when interruptConversation is called", async () => {
    const { result } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.interruptConversation();
    });

    // Wake lock should have been released (not re-acquired)
    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);
  });

  it("releases wake lock on component unmount", async () => {
    const { result, unmount } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      unmount();
    });

    // Cleanup should have released the wake lock
    expect(mockWakeLockRequest).toHaveBeenCalledTimes(1);
  });

  it("silently skips wake lock when not supported", async () => {
    // Remove wakeLock from navigator
    // @ts-expect-error - intentionally removing for test
    navigator.wakeLock = undefined;

    const { result } = renderHook(() =>
      useVoiceChat({ onSendMessage: vi.fn() }),
    );

    await act(async () => {
      result.current.startConversation();
    });

    // Should not throw
    expect(mockWakeLockRequest).not.toHaveBeenCalled();

    // Restore for other tests
    mockWakeLockRequest.mockResolvedValue(new FakeWakeLockSentinel());
    // @ts-expect-error - restoring for other tests
    navigator.wakeLock = { request: mockWakeLockRequest };
  });
});
