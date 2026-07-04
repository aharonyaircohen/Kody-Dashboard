/**
 * Background service worker — message router.
 *
 * Content scripts in different frames of the same tab can't talk to each
 * other directly; they relay through here. Roles:
 *   - The dashboard's TOP frame runs the "bridge" (see content.js).
 *   - Each preview iframe (sub-frame) runs the "picker + collector".
 *
 * Routing:
 *   - arm/disarm/collect-logs/collect-network : bridge → every frame
 *     (only sub-frame pickers act on them).
 *   - selected/logs/network                   : a sub-frame → top frame (bridge).
 *   - capture-screenshot                       : bridge → here; we grab the
 *     visible tab and send { screenshot } back down to the top frame.
 *
 * Detection (ping/pong) never reaches here — the bridge answers the page
 * directly, so an uninstalled extension simply yields no pong.
 */
const BROADCAST_DOWN = new Set([
  "arm",
  "disarm",
  "collect-logs",
  "collect-network",
  "collect-perf",
  "collect-page",
  "act",
  "preview-edit",
  "preview-edit-undo",
  "preview-edit-reset",
  "record-start",
  "record-stop",
]);
const RELAY_UP = new Set([
  "selected",
  "logs",
  "network",
  "counts",
  "perf",
  "page",
  "act-result",
  "preview-edit-result",
  "recording",
  "rec-count",
]);

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") return;

  if (BROADCAST_DOWN.has(msg?.kind)) {
    // Forward the whole message (including payload + requestId), not just
    // the kind. Sub-frames execute and the top-frame bridge ignores it.
    chrome.tabs.sendMessage(tabId, msg).catch(() => {});
    return;
  }

  if (RELAY_UP.has(msg?.kind)) {
    // Route results up to the dashboard bridge (top frame).
    chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
    return;
  }

  if (msg?.kind === "capture-screenshot") {
    const windowId = sender.tab?.windowId;
    chrome.tabs
      .captureVisibleTab(windowId, { format: "png" })
      .then((dataUrl) => {
        chrome.tabs
          .sendMessage(tabId, { kind: "screenshot", dataUrl }, { frameId: 0 })
          .catch(() => {});
      })
      .catch((err) => {
        chrome.tabs
          .sendMessage(
            tabId,
            { kind: "screenshot", error: String(err) },
            { frameId: 0 },
          )
          .catch(() => {});
      });
  }
});
