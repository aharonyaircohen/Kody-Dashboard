/**
 * Content script — runs in EVERY frame of EVERY page (the privilege a normal
 * web page doesn't have: it can reach inside a cross-origin preview iframe).
 *
 * One file, two roles decided by frame position:
 *   - Top frame  → BRIDGE. Relays between the dashboard page's window.postMessage
 *                  API and the extension background. Inert on any site that never
 *                  pings it (i.e. everything except the Kody dashboard).
 *   - Sub-frame  → PICKER + COLLECTOR. Dormant until armed (pick), and always
 *                  buffering console errors / failed requests for on-demand send.
 *
 * Message contract with the dashboard page (window.postMessage):
 *   page → bridge : { source: "kody-picker:page",
 *                     type: "ping"|"arm"|"disarm"|"collect-logs"|"collect-network"|"screenshot" }
 *   bridge → page : { source: "kody-picker:ext",
 *                     type: "pong"|"armed"|"disarmed"|"selected"|"logs"|"network"|"screenshot", ... }
 * Keep these strings in sync with src/dashboard/lib/picker/protocol.ts.
 */
(() => {
  "use strict";

  const PAGE_SOURCE = "kody-picker:page";
  const EXT_SOURCE = "kody-picker:ext";
  const COLLECTOR_SOURCE = "kody-picker:collector";
  const VERSION = "0.2.2";
  const BUFFER_CAP = 50;

  if (window.top === window.self) {
    initBridge();
  } else {
    initPicker();
  }

  // ---------------------------------------------------------------------------
  // BRIDGE (top frame / the dashboard)
  // ---------------------------------------------------------------------------
  function initBridge() {
    // Synchronous presence marker — lets the page detect us without waiting
    // for the ping/pong round-trip.
    try {
      document.documentElement.dataset.kodyPicker = VERSION;
    } catch {
      /* dataset may be unavailable pre-DOM; ping/pong still covers detection */
    }

    const postToPage = (payload) => {
      window.postMessage(
        { source: EXT_SOURCE, ...payload },
        window.location.origin,
      );
    };

    // page → background request kinds (broadcast down or handled by bg).
    const PAGE_TO_BG = {
      arm: { kind: "arm" },
      disarm: { kind: "disarm" },
      "collect-logs": { kind: "collect-logs" },
      "collect-network": { kind: "collect-network" },
      screenshot: { kind: "capture-screenshot" },
    };

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== PAGE_SOURCE) return;

      if (data.type === "ping") {
        postToPage({ type: "pong", version: VERSION });
        return;
      }
      const relay = PAGE_TO_BG[data.type];
      if (relay) {
        chrome.runtime.sendMessage(relay).catch(() => {});
        if (data.type === "arm") postToPage({ type: "armed" });
        if (data.type === "disarm") postToPage({ type: "disarmed" });
      }
    });

    // background → page: results coming up from the sub-frames / capture.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.kind === "selected") {
        postToPage({ type: "selected", element: msg.element });
      } else if (msg?.kind === "logs") {
        postToPage({ type: "logs", entries: msg.entries });
      } else if (msg?.kind === "network") {
        postToPage({ type: "network", entries: msg.entries });
      } else if (msg?.kind === "screenshot") {
        postToPage({ type: "screenshot", dataUrl: msg.dataUrl, error: msg.error });
      } else if (msg?.kind === "counts") {
        postToPage({ type: "counts", logs: msg.logs, network: msg.network });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // PICKER + COLLECTOR (sub-frame / the preview iframe)
  // ---------------------------------------------------------------------------
  function initPicker() {
    let armed = false;
    let box = null;
    let current = null;
    const logBuffer = [];
    const netBuffer = [];

    // Coalesce count pushes so a chatty app doesn't flood the bridge.
    // NOTE: declared before first use — `pushCounts` reads `countsTimer`, so
    // calling it before this `let` runs would throw (TDZ) and abort init,
    // silently breaking arm/disarm. Keep this above injectCollector().
    let countsTimer = null;
    function pushCounts() {
      if (countsTimer) return;
      countsTimer = setTimeout(() => {
        countsTimer = null;
        chrome.runtime
          .sendMessage({
            kind: "counts",
            logs: logBuffer.length,
            network: netBuffer.length,
          })
          .catch(() => {});
      }, 400);
    }

    injectCollector();
    // Reset the dashboard badges for this (re)loaded frame.
    pushCounts();

    // Receive buffered entries from the page main-world collector.
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== COLLECTOR_SOURCE) return;
      const buf = d.kind === "log" ? logBuffer : d.kind === "net" ? netBuffer : null;
      if (!buf) return;
      buf.push(d.entry);
      if (buf.length > BUFFER_CAP) buf.shift();
      pushCounts();
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.kind === "arm") arm();
      else if (msg?.kind === "disarm") disarm();
      else if (msg?.kind === "collect-logs") {
        chrome.runtime
          .sendMessage({ kind: "logs", entries: logBuffer.slice() })
          .catch(() => {});
      } else if (msg?.kind === "collect-network") {
        chrome.runtime
          .sendMessage({ kind: "network", entries: netBuffer.slice() })
          .catch(() => {});
      }
    });

    // -- picker (arm → highlight → click → capture) ----------------------------
    function arm() {
      if (armed) return;
      armed = true;
      ensureBox();
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKey, true);
    }

    function disarm() {
      if (!armed) return;
      armed = false;
      current = null;
      removeBox();
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        disarm();
        chrome.runtime.sendMessage({ kind: "disarm" }).catch(() => {});
      }
    }

    function onMove(e) {
      const el = e.target;
      if (!(el instanceof Element)) return;
      current = el;
      drawBox(el);
    }

    function onClick(e) {
      if (!armed) return;
      // Stop the click from activating the page (links, buttons, etc.).
      e.preventDefault();
      e.stopPropagation();
      const el = e.target instanceof Element ? e.target : current;
      if (!el) return;
      chrome.runtime
        .sendMessage({ kind: "selected", element: describe(el) })
        .catch(() => {});
      disarm();
    }

    // -- highlight overlay -----------------------------------------------------
    function ensureBox() {
      if (box) return;
      box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid #34d399",
        background: "rgba(52, 211, 153, 0.12)",
        borderRadius: "2px",
        transition: "all 40ms ease-out",
        top: "0",
        left: "0",
        width: "0",
        height: "0",
      });
      (document.body || document.documentElement).appendChild(box);
    }

    function drawBox(el) {
      if (!box) return;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        top: `${r.top}px`,
        left: `${r.left}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }

    function removeBox() {
      if (box && box.parentNode) box.parentNode.removeChild(box);
      box = null;
    }

    // -- element description ---------------------------------------------------
    function describe(el) {
      const rect = el.getBoundingClientRect();
      const attributes = {};
      for (const attr of Array.from(el.attributes)) {
        attributes[attr.name] = attr.value;
      }
      return {
        selector: buildSelector(el),
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300),
        attributes,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        url: window.location.href,
      };
    }

    // Build a reasonably stable CSS selector by walking up to <body>,
    // short-circuiting on the first ancestor that carries an id.
    function buildSelector(el) {
      if (el.id) return `#${cssEscape(el.id)}`;
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body) {
        let part = node.tagName.toLowerCase();
        if (node.id) {
          parts.unshift(`#${cssEscape(node.id)}`);
          break;
        }
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => c.tagName === node.tagName,
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
          }
        }
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
      }
      return value.replace(/([^a-zA-Z0-9_-])/g, "\\$1");
    }

    // -- main-world collector --------------------------------------------------
    // Content scripts run in an isolated world, so they can't see the page's
    // own console.* calls or wrap fetch. We inject a tiny script into the page
    // main world that wraps those and posts captured entries back to us.
    function injectCollector() {
      try {
        const code = `(${collectorSource})("${COLLECTOR_SOURCE}", ${BUFFER_CAP});`;
        const s = document.createElement("script");
        s.textContent = code;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } catch {
        /* CSP may block inline injection — errors are then simply uncaptured */
      }
    }
  }

  // Stringified and injected into the page main world. Must be self-contained
  // (no closure refs). Posts { source, kind: "log"|"net", entry } to window.
  function collectorSource(source, cap) {
    var post = function (kind, entry) {
      try {
        window.postMessage({ source: source, kind: kind, entry: entry }, "*");
      } catch (e) {
        /* ignore */
      }
    };
    ["error", "warn"].forEach(function (level) {
      var orig = console[level];
      console[level] = function () {
        try {
          post("log", {
            level: level,
            message: Array.prototype.map
              .call(arguments, function (a) {
                return a instanceof Error ? a.message : String(a);
              })
              .join(" ")
              .slice(0, 1000),
            ts: Date.now(),
          });
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      };
    });
    window.addEventListener("error", function (e) {
      post("log", {
        level: "error",
        message:
          (e.message || "Error") +
          (e.filename ? " (" + e.filename + ":" + e.lineno + ":" + e.colno + ")" : ""),
        ts: Date.now(),
      });
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e.reason;
      post("log", {
        level: "error",
        message: "Unhandled rejection: " + (r && r.message ? r.message : String(r)),
        ts: Date.now(),
      });
    });
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function () {
        var args = arguments;
        var first = args[0];
        var url = first && first.url ? first.url : String(first);
        var method = (args[1] && args[1].method) || (first && first.method) || "GET";
        return origFetch.apply(this, args).then(
          function (res) {
            if (!res.ok)
              post("net", { url: url, method: method, status: res.status, ts: Date.now() });
            return res;
          },
          function (err) {
            post("net", {
              url: url,
              method: method,
              status: 0,
              error: String(err),
              ts: Date.now(),
            });
            throw err;
          },
        );
      };
    }
    var OX = window.XMLHttpRequest;
    if (OX) {
      var open = OX.prototype.open;
      var send = OX.prototype.send;
      OX.prototype.open = function (m, u) {
        this.__kody = { method: m, url: u };
        return open.apply(this, arguments);
      };
      OX.prototype.send = function () {
        var self = this;
        this.addEventListener("loadend", function () {
          if (self.__kody && (self.status === 0 || self.status >= 400)) {
            post("net", {
              url: self.__kody.url,
              method: self.__kody.method,
              status: self.status,
              ts: Date.now(),
            });
          }
        });
        return send.apply(this, arguments);
      };
    }
  }
})();
