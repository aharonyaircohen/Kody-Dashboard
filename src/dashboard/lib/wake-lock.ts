/**
 * @fileType utility
 * @domain kody
 * @pattern wake-lock
 * @ai-summary Keeps the screen awake during voice mode using the Screen Wake Lock API
 */

/**
 * Acquires a screen wake lock. Returns null if the API is unsupported
 * or if the request fails (e.g., the page is not visible).
 *
 * The returned WakeLockSentinel must be released by calling its `.release()`
 * method when no longer needed.
 */
export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return null;
  }
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

/**
 * Releases a WakeLockSentinel if it is still held.
 */
export async function releaseWakeLock(
  sentinel: WakeLockSentinel | null,
): Promise<void> {
  if (sentinel) {
    try {
      await sentinel.release();
    } catch {
      // Already released — ignore.
    }
  }
}
