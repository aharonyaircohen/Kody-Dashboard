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
  const VERSION = "0.3.3";
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
      "collect-perf": { kind: "collect-perf" },
      "collect-page": { kind: "collect-page" },
      "record-start": { kind: "record-start" },
      "record-stop": { kind: "record-stop" },
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
        postToPage({
          type: "screenshot",
          dataUrl: msg.dataUrl,
          error: msg.error,
        });
      } else if (msg?.kind === "counts") {
        postToPage({ type: "counts", logs: msg.logs, network: msg.network });
      } else if (msg?.kind === "perf") {
        postToPage({ type: "perf", report: msg.report });
      } else if (msg?.kind === "recording") {
        postToPage({ type: "recording", steps: msg.steps, url: msg.url });
      } else if (msg?.kind === "rec-count") {
        postToPage({ type: "rec-count", count: msg.count });
      } else if (msg?.kind === "page") {
        postToPage({ type: "page", info: msg.info });
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

    // Largest Contentful Paint — observed (buffered replays past entries) so a
    // late-loading content script still sees it. Read on demand for "Speed".
    let lcpMs = 0;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) lcpMs = last.renderTime || last.startTime || lcpMs;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      /* unsupported — report omits LCP */
    }

    // Test recorder — buffers user actions (click/fill) while recording.
    let recording = false;
    const recSteps = [];

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
      const buf =
        d.kind === "log" ? logBuffer : d.kind === "net" ? netBuffer : null;
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
      } else if (msg?.kind === "collect-perf") {
        chrome.runtime
          .sendMessage({ kind: "perf", report: computePerf() })
          .catch(() => {});
      } else if (msg?.kind === "collect-page") {
        chrome.runtime
          .sendMessage({ kind: "page", info: collectPageInfo() })
          .catch(() => {});
      } else if (msg?.kind === "record-start") {
        startRecording();
      } else if (msg?.kind === "record-stop") {
        chrome.runtime
          .sendMessage({
            kind: "recording",
            steps: recSteps.slice(),
            url: window.location.href,
          })
          .catch(() => {});
        stopRecording();
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

    // -- test recorder ---------------------------------------------------------
    // Records user actions (without blocking them) so one click-through becomes
    // a Playwright test. `change` (not keystroke) captures fills on commit.
    function startRecording() {
      if (recording) return;
      recording = true;
      recSteps.length = 0;
      document.addEventListener("click", onRecClick, true);
      document.addEventListener("change", onRecChange, true);
      pushRecCount();
    }

    function stopRecording() {
      recording = false;
      document.removeEventListener("click", onRecClick, true);
      document.removeEventListener("change", onRecChange, true);
    }

    function onRecClick(e) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      recSteps.push({
        type: "click",
        selector: buildSelector(el),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      });
      pushRecCount();
    }

    function onRecChange(e) {
      const el = e.target;
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        )
      ) {
        return;
      }
      const masked = el instanceof HTMLInputElement && el.type === "password";
      recSteps.push({
        type: "fill",
        selector: buildSelector(el),
        value: masked ? "********" : String(el.value).slice(0, 200),
      });
      pushRecCount();
    }

    function pushRecCount() {
      chrome.runtime
        .sendMessage({ kind: "rec-count", count: recSteps.length })
        .catch(() => {});
    }

    // -- page context (URL + title + selection) -------------------------------
    // Tiny snapshot of where the user is and what they highlighted. Selection
    // is capped + trimmed so a stray "Select All" doesn't blow up the prompt.
    function collectPageInfo() {
      var selection = "";
      try {
        var s = window.getSelection();
        if (s && s.toString) {
          selection = s.toString().trim().replace(/\s+/g, " ").slice(0, 500);
        }
      } catch {
        /* ignore */
      }
      return {
        url: window.location.href,
        title: (document.title || "").trim().slice(0, 200),
        selection,
        dom: collectDomDigest(),
      };
    }

    // Compact outline of interactive + heading + landmark elements with text.
    // Lets chat answer "what's on this page" / "is there a Save button" without
    // shipping the full HTML. Skips hidden nodes, caps total bytes.
    function collectDomDigest() {
      var root = document.body;
      if (!root) return "";
      var KEEP = {
        h1: 1, h2: 1, h3: 1, h4: 1,
        button: 1, a: 1, input: 1, textarea: 1, select: 1, label: 1,
        nav: 1, main: 1, header: 1, footer: 1, section: 1, article: 1,
        form: 1, summary: 1,
      };
      var SKIP = { script: 1, style: 1, svg: 1, noscript: 1 };
      var out = [];
      var BUDGET = 3000;
      var bytes = 0;

      function isVisible(el) {
        try {
          var r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          var cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          return true;
        } catch {
          return true;
        }
      }
      function describeEl(el) {
        var tag = el.tagName.toLowerCase();
        var id = el.id ? "#" + el.id : "";
        var role = el.getAttribute("role");
        var text = (el.textContent || "")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 120);
        var extra = "";
        if (tag === "a") {
          var href = el.getAttribute("href") || "";
          extra = ' href="' + href.slice(0, 80) + '"';
        } else if (tag === "input" || tag === "textarea" || tag === "select") {
          var type = el.getAttribute("type") || tag;
          var ph =
            el.getAttribute("placeholder") ||
            el.getAttribute("aria-label") ||
            el.getAttribute("name") ||
            "";
          extra =
            ' type="' + type + '"' + (ph ? ' label="' + ph.slice(0, 60) + '"' : "");
          text = "";
        }
        if (role) extra += ' role="' + role + '"';
        return "<" + tag + id + extra + ">" + (text ? " " + text : "");
      }
      function walk(el, depth) {
        if (bytes >= BUDGET) return;
        if (!(el instanceof Element)) return;
        var tag = el.tagName.toLowerCase();
        if (SKIP[tag]) return;
        if (!isVisible(el)) return;
        if (KEEP[tag]) {
          var line = "  ".repeat(Math.min(depth, 6)) + describeEl(el);
          out.push(line);
          bytes += line.length + 1;
        }
        var kids = el.children;
        for (var i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
      }
      walk(root, 0);
      return out.join("\n").slice(0, BUDGET);
    }

    // -- performance snapshot --------------------------------------------------
    function computePerf() {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      const resources = performance.getEntriesByType("resource");
      const slowest = resources
        .map((r) => ({
          url: r.name,
          type: r.initiatorType,
          durationMs: Math.round(r.duration),
          bytes: r.transferSize || 0,
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 8);
      return {
        url: window.location.href,
        ttfbMs: nav ? Math.round(nav.responseStart) : 0,
        domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
        loadMs: nav ? Math.round(nav.loadEventEnd) : 0,
        fcpMs: fcp ? Math.round(fcp.startTime) : 0,
        lcpMs: Math.round(lcpMs),
        resourceCount: resources.length,
        totalBytes: resources.reduce((s, r) => s + (r.transferSize || 0), 0),
        slowest,
      };
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
      const tag = el.tagName.toLowerCase();
      const isField = tag === "input" || tag === "textarea";
      const sensitive = isSensitiveField(el, tag);
      const attributes = {};
      for (const attr of Array.from(el.attributes)) {
        // A field's value can hold a password, token, or PII — never surface
        // it to chat. Redact sensitive fields; drop the value for any field.
        if (attr.name === "value" && isField) {
          if (sensitive) attributes[attr.name] = "[redacted]";
          continue;
        }
        attributes[attr.name] = attr.value;
      }
      return {
        selector: buildSelector(el),
        tagName: tag,
        id: el.id || null,
        classes: Array.from(el.classList),
        // Sensitive fields: don't capture text either (some inputs mirror the
        // value into a sibling/shadow node shown as ••• / ***).
        text: sensitive
          ? ""
          : (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 300),
        attributes,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        url: window.location.href,
      };
    }

    // Password / secret / payment fields whose value must never leave the page.
    function isSensitiveField(el, tag) {
      if (tag !== "input" && tag !== "textarea") return false;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "password") return true;
      const hint = (
        (el.getAttribute("name") || "") +
        " " +
        (el.id || "") +
        " " +
        (el.getAttribute("autocomplete") || "")
      ).toLowerCase();
      return /pass|secret|cvv|cvc|card|otp|ssn|token|\bpin\b/.test(hint);
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
          (e.filename
            ? " (" + e.filename + ":" + e.lineno + ":" + e.colno + ")"
            : ""),
        ts: Date.now(),
      });
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e.reason;
      post("log", {
        level: "error",
        message:
          "Unhandled rejection: " + (r && r.message ? r.message : String(r)),
        ts: Date.now(),
      });
    });
    var origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function () {
        var args = arguments;
        var first = args[0];
        var url = first && first.url ? first.url : String(first);
        var method =
          (args[1] && args[1].method) || (first && first.method) || "GET";
        return origFetch.apply(this, args).then(
          function (res) {
            if (!res.ok)
              post("net", {
                url: url,
                method: method,
                status: res.status,
                ts: Date.now(),
              });
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
