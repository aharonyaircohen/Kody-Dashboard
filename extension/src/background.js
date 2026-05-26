/**
 * Background service worker — message router.
 *
 * Content scripts in different frames of the same tab can't talk to each
 * other directly; they relay through here. Roles:
 *   - The dashboard's TOP frame runs the "bridge" (see content.js).
 *   - Each preview iframe (sub-frame) runs the "picker".
 *
 * We only route two things:
 *   - arm/disarm  : bridge → every frame (only sub-frame pickers act on it).
 *   - selected    : a picker sub-frame → the top frame (frameId 0 = bridge).
 *
 * Detection (ping/pong) never reaches here — the bridge answers the page
 * directly, so an uninstalled extension simply yields no pong.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;

  if (msg?.kind === "arm" || msg?.kind === "disarm") {
    // Broadcast to all frames in the tab; the top-frame bridge ignores it.
    chrome.tabs.sendMessage(tabId, { kind: msg.kind }).catch(() => {});
    return;
  }

  if (msg?.kind === "selected") {
    // Route the picked element up to the dashboard bridge (top frame).
    chrome.tabs
      .sendMessage(
        tabId,
        { kind: "selected", element: msg.element },
        { frameId: 0 },
      )
      .catch(() => {});
  }
});
