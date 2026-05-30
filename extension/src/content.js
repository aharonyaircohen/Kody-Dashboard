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
  const VERSION = "0.4.0";
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
      act: { kind: "act" },
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
        // Some relay kinds carry a payload (act carries the action spec +
        // requestId). Pass `payload` and `requestId` through verbatim so
        // the sub-frame can execute and reply via the matching id.
        const out = { ...relay };
        if (data.payload !== undefined) out.payload = data.payload;
        if (data.requestId !== undefined) out.requestId = data.requestId;
        chrome.runtime.sendMessage(out).catch(() => {});
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
      } else if (msg?.kind === "act-result") {
        postToPage({
          type: "act-result",
          requestId: msg.requestId,
          ok: msg.ok,
          error: msg.error,
          info: msg.info,
        });
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

    // If a navigation was triggered by a previous `act` in this sub-frame
    // (window.location.assign), the act-result with the NEW page's DOM
    // must come from the new context (this one). Wait for the page to
    // settle, then deliver the result and clear the pending marker.
    (function deliverPendingNavigateResult() {
      var pending = null;
      try {
        var raw = sessionStorage.getItem("__kody_pending_act");
        if (!raw) return;
        pending = JSON.parse(raw);
        sessionStorage.removeItem("__kody_pending_act");
      } catch (e) {
        return;
      }
      if (!pending || !pending.requestId) return;
      // Stale guard — if more than 10s elapsed something else went wrong.
      if (Date.now() - (pending.ts || 0) > 10_000) return;
      function deliver() {
        chrome.runtime
          .sendMessage({
            kind: "act-result",
            requestId: pending.requestId,
            ok: true,
            info: collectPageInfo(),
          })
          .catch(function () {});
      }
      if (document.readyState === "complete") {
        // Give frameworks a tick to render before snapshotting.
        setTimeout(deliver, 100);
      } else {
        window.addEventListener("load", function () {
          setTimeout(deliver, 100);
        });
      }
    })();

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
      } else if (msg?.kind === "act") {
        // Navigation ops tear down this JS context — we can't deliver a
        // result with the new page's DOM from here. Stash the requestId
        // in sessionStorage; the new page's content script (re-injected
        // on document_idle) picks it up and emits a fresh act-result
        // with the post-navigation DOM. Same for clicks/submits that
        // trigger navigation (handled by a beforeunload listener below).
        var op = msg.payload && msg.payload.op;
        if (op === "navigate") {
          try {
            sessionStorage.setItem(
              "__kody_pending_act",
              JSON.stringify({ requestId: msg.requestId, ts: Date.now() }),
            );
          } catch (e) {
            /* private mode etc — fall through to immediate result */
          }
        }
        void performAction(msg.payload).then(function (result) {
          if (!result.ok && result.error === "not found") return;
          // For navigate ops, the new page will deliver the result. Don't
          // send a stale snapshot now.
          if (op === "navigate" && result.ok) return;
          chrome.runtime
            .sendMessage({
              kind: "act-result",
              requestId: msg.requestId,
              ok: result.ok,
              error: result.error,
              info: collectPageInfo(),
            })
            .catch(function () {});
        });
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

    // -- chat-driven actions ---------------------------------------------------
    // Executes a single action requested by chat. Returns { ok, error }.
    // Always pairs with a follow-up `collectPageInfo()` snapshot in the
    // reply so the model sees what changed.
    function performAction(payload) {
      return new Promise(function (resolve) {
        try {
          if (!payload || typeof payload.op !== "string") {
            return resolve({ ok: false, error: "missing op" });
          }
          var op = payload.op;
          if (op === "navigate") {
            var href = String(payload.url || "");
            if (!href) return resolve({ ok: false, error: "missing url" });
            // Same-origin only (avoids hijacking the parent tab).
            try {
              var u = new URL(href, window.location.href);
              if (u.origin !== window.location.origin) {
                return resolve({
                  ok: false,
                  error: "cross-origin navigation blocked",
                });
              }
              window.location.assign(u.href);
              return resolve({ ok: true });
            } catch (e) {
              return resolve({ ok: false, error: "invalid url" });
            }
          }
          if (op === "scroll") {
            var selector = payload.selector;
            if (selector) {
              var target = safeQuery(selector);
              if (!target) return resolve({ ok: false, error: "not found" });
              target.scrollIntoView({ behavior: "smooth", block: "center" });
              return resolve({ ok: true });
            }
            var dy = Number(payload.dy || 0);
            window.scrollBy({ top: dy, behavior: "smooth" });
            return resolve({ ok: true });
          }
          if (op === "wait") {
            var ms = Math.min(Math.max(Number(payload.ms || 200), 0), 5000);
            setTimeout(function () {
              resolve({ ok: true });
            }, ms);
            return;
          }
          if (op === "click") {
            var el = safeQuery(payload.selector);
            if (!el) return resolve({ ok: false, error: "not found" });
            if (!(el instanceof HTMLElement))
              return resolve({ ok: false, error: "not clickable" });
            // The matched element is often a descendant (span inside a
            // button, text node inside a clickable card). Walk up to the
            // nearest interactive ancestor so the click reaches the real
            // handler instead of dying on a non-listening child.
            var target = closestInteractive(el);
            try {
              target.scrollIntoView({ block: "center" });
            } catch (e) {
              /* ignore */
            }
            // Overlay/intercept check — if a modal backdrop, tooltip, or
            // any other element occupies the target's center hit-test,
            // the click won't reach our intended target. Surface that
            // explicitly so the model can dismiss the overlay first.
            var blocker = findInterceptor(target);
            if (blocker) {
              return resolve({
                ok: false,
                error: "blocked by overlay: " + describeBlocker(blocker),
              });
            }
            // Snapshot the URL so we can detect SPA navigation after the
            // click (history.pushState / router.push). Real apps switch
            // routes this way — we wait briefly and re-snapshot the DOM
            // if the URL or document body changed.
            var beforeUrl = window.location.href;
            var beforeBodyLen = (document.body && document.body.innerHTML.length) || 0;
            // Full event sequence — many UI libs (Radix, cmdk, framer-motion)
            // need pointerdown/mousedown to register an interaction, not
            // just a bare click. element.click() alone misses these.
            simulateClick(target);
            // Wait briefly for SPA routers / React state updates to settle
            // before sampling the post-click DOM. 250ms covers the common
            // case (React re-render + Router transition) without making
            // chat-driven clicks feel slow.
            setTimeout(function () {
              var afterUrl = window.location.href;
              var spaNavigated = afterUrl !== beforeUrl;
              // If a SPA nav happened, the URL changed but no page reload
              // tore down our context — so we can just take a fresh
              // snapshot here and let the dashboard's act-result wrapper
              // pick it up.
              void spaNavigated;
              void beforeBodyLen;
              resolve({ ok: true });
            }, 250);
            return;
          }
          if (op === "fill") {
            var inp = safeQuery(payload.selector);
            if (!inp) return resolve({ ok: false, error: "not found" });
            if (
              !(
                inp instanceof HTMLInputElement ||
                inp instanceof HTMLTextAreaElement ||
                inp instanceof HTMLSelectElement
              )
            ) {
              // Try contenteditable as a fallback.
              if (inp instanceof HTMLElement && inp.isContentEditable) {
                inp.focus();
                inp.textContent = String(payload.value || "");
                inp.dispatchEvent(new Event("input", { bubbles: true }));
                return resolve({ ok: true });
              }
              return resolve({ ok: false, error: "not a fillable field" });
            }
            // React/Vue controlled-input safe set: use the native setter.
            var proto =
              inp instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : inp instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, "value");
            if (setter && setter.set) {
              setter.set.call(inp, String(payload.value || ""));
            } else {
              inp.value = String(payload.value || "");
            }
            inp.dispatchEvent(new Event("input", { bubbles: true }));
            inp.dispatchEvent(new Event("change", { bubbles: true }));
            return resolve({ ok: true });
          }
          return resolve({ ok: false, error: "unknown op: " + op });
        } catch (err) {
          return resolve({ ok: false, error: String(err && err.message ? err.message : err) });
        }
      });
    }

    // Resolve a selector to an element. Tries raw CSS first; falls back to
    // Playwright/Cypress-flavored text selectors so the model can write
    // `button:has-text("Login")` or `text="Save"` without us forcing pure
    // CSS. Returns null when neither path matches.
    function safeQuery(selector) {
      if (typeof selector !== "string" || !selector) return null;
      try {
        var el = document.querySelector(selector);
        if (el) return el;
        // Pass 1.5: same selector, walking shadow roots — many design
        // systems (Lit / native web components, some MUI variants) hide
        // their internals behind a closed-styling shadow root that
        // querySelector can't pierce.
        var deep = deepQuerySelector(selector, document);
        if (deep) return deep;
      } catch {
        /* not valid CSS — try text-selector fallback below */
      }
      var parsed = parseTextSelector(selector);
      if (!parsed) return null;
      // Pass 2: scan the usual interactive elements (fast common case).
      var hit = findByText(parsed.text, parsed.tag);
      if (hit) return hit;
      // Pass 3: broader scan for clickable cards/divs/wrappers — anything
      // that contains the text. Walk up to the nearest interactive
      // ancestor on click. This is what catches the "grade card" pattern.
      return findAnyWithText(parsed.text, parsed.tag);
    }

    // Recursively search through shadow roots — `document.querySelector`
    // can't pierce shadow boundaries, so encapsulated web components are
    // invisible to it by default.
    function deepQuerySelector(selector, root) {
      try {
        var direct = root.querySelector ? root.querySelector(selector) : null;
        if (direct) return direct;
      } catch {
        return null;
      }
      // BFS through shadow roots. Cap depth/breadth so a pathological
      // tree can't lock the page.
      var queue = [root];
      var visited = 0;
      while (queue.length && visited < 2000) {
        var node = queue.shift();
        visited++;
        var children = node.querySelectorAll ? node.querySelectorAll("*") : [];
        for (var i = 0; i < children.length; i++) {
          var c = children[i];
          if (c.shadowRoot) {
            try {
              var found = c.shadowRoot.querySelector(selector);
              if (found) return found;
            } catch {
              /* ignore invalid CSS in shadow */
            }
            queue.push(c.shadowRoot);
          }
        }
      }
      return null;
    }

    // Hit-test: does the target's center actually receive a click, or is
    // something else painted on top? Returns null when the target (or its
    // descendant) is the hit element — i.e. the click will land where we
    // expect.
    function findInterceptor(target) {
      try {
        var rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        // elementFromPoint operates in viewport coords; we already
        // scrollIntoView'd so the target should be visible.
        var top = document.elementFromPoint(x, y);
        if (!top) return null;
        if (top === target || target.contains(top)) return null;
        // Hit element is an ancestor of the target (clickable wrapper).
        if (top.contains && top.contains(target)) return null;
        // Target is inside a shadow root: elementFromPoint can't see in;
        // it returns the host (or an ancestor of the host). Walk up the
        // shadow chain — if `top` matches or contains a shadow host on
        // the chain back to `target`, the click will land correctly.
        var node = target;
        for (var hops = 0; hops < 8 && node; hops++) {
          var root = node.getRootNode ? node.getRootNode() : null;
          var host = root && root.host ? root.host : null;
          if (!host) break;
          if (top === host || (top.contains && top.contains(host))) return null;
          node = host;
        }
        return top;
      } catch {
        return null;
      }
    }

    // Short identifier for whatever's blocking the click. Helps the model
    // decide what to dismiss (e.g. modal-backdrop, tooltip).
    function describeBlocker(el) {
      try {
        var tag = el.tagName ? el.tagName.toLowerCase() : "?";
        var id = el.id ? "#" + el.id : "";
        var cls = el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
        var role = el.getAttribute && el.getAttribute("role");
        return "<" + tag + id + cls + (role ? ' role="' + role + '"' : "") + ">";
      } catch {
        return "<unknown>";
      }
    }

    // Walk up from `el` to the nearest element that's likely to be the
    // real click target (a button, link, role=button, tabindex, [onclick],
    // or anything with cursor:pointer). Falls back to the element itself.
    function closestInteractive(el) {
      if (!(el instanceof Element)) return el;
      var INTERACTIVE_TAGS = { BUTTON: 1, A: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1, LABEL: 1 };
      var node = el;
      var hops = 0;
      while (node && hops < 8) {
        if (INTERACTIVE_TAGS[node.tagName]) return node;
        var role = node.getAttribute && node.getAttribute("role");
        if (role === "button" || role === "link" || role === "tab" || role === "menuitem") return node;
        if (node.getAttribute && node.getAttribute("tabindex") !== null) return node;
        if (node.hasAttribute && node.hasAttribute("onclick")) return node;
        try {
          var cs = window.getComputedStyle(node);
          if (cs && cs.cursor === "pointer") return node;
        } catch (e) {
          /* ignore */
        }
        node = node.parentElement;
        hops++;
      }
      return el;
    }

    // Find any element on the page whose visible text matches. Used as a
    // second-pass when the strict button/link scan missed (e.g. clickable
    // card divs). Returns the SMALLEST matching element (least textContent
    // length) so we hit the leaf, then click walks up to the interactive
    // ancestor before dispatching. Walks shadow roots too.
    function findAnyWithText(text, tagFilter) {
      var needle = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!needle) return null;
      var selector = tagFilter || "*";
      var nodes = collectAcrossShadow(document, selector);
      var best = null;
      var bestLen = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var raw = (el.textContent || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (!raw) continue;
        if (raw === needle || raw.indexOf(needle) !== -1) {
          if (raw.length < bestLen) {
            best = el;
            bestLen = raw.length;
            if (raw === needle && raw.length === needle.length) break;
          }
        }
      }
      return best;
    }

    // querySelectorAll that walks shadow roots. Returns a flat array so
    // callers can iterate without thinking about composition.
    function collectAcrossShadow(root, selector) {
      var out = [];
      try {
        var direct = root.querySelectorAll ? root.querySelectorAll(selector) : [];
        for (var i = 0; i < direct.length; i++) out.push(direct[i]);
      } catch {
        return out;
      }
      var queue = [root];
      var visited = 0;
      while (queue.length && visited < 2000) {
        var node = queue.shift();
        visited++;
        var kids = node.querySelectorAll ? node.querySelectorAll("*") : [];
        for (var j = 0; j < kids.length; j++) {
          var c = kids[j];
          if (c.shadowRoot) {
            try {
              var inside = c.shadowRoot.querySelectorAll(selector);
              for (var k = 0; k < inside.length; k++) out.push(inside[k]);
            } catch {
              /* ignore */
            }
            queue.push(c.shadowRoot);
          }
        }
      }
      return out;
    }

    // Simulate a full mouse-click sequence. element.click() alone misses
    // pointer-based handlers in libs like Radix / cmdk / framer-motion.
    function simulateClick(el) {
      try {
        var rect = el.getBoundingClientRect();
        var x = Math.round(rect.left + rect.width / 2);
        var y = Math.round(rect.top + rect.height / 2);
        var common = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
        try {
          el.dispatchEvent(new PointerEvent("pointerdown", common));
        } catch (e) {
          /* PointerEvent may be unsupported */
        }
        el.dispatchEvent(new MouseEvent("mousedown", common));
        try {
          el.dispatchEvent(new PointerEvent("pointerup", common));
        } catch (e) {
          /* ignore */
        }
        el.dispatchEvent(new MouseEvent("mouseup", common));
        el.dispatchEvent(new MouseEvent("click", common));
      } catch (e) {
        try {
          el.click();
        } catch (e2) {
          /* swallow */
        }
      }
    }

    // Keep this in sync with src/dashboard/lib/picker/protocol.ts:parseTextSelector
    // — that one is unit-tested; this one runs in the page.
    function parseTextSelector(selector) {
      if (!selector) return null;
      var pseudo = selector.match(
        /^([a-zA-Z][\w-]*)?:(?:has-text|text|text-is|text-matches)\(["']([^"']+)["']\)$/,
      );
      if (pseudo) {
        var out = { text: pseudo[2] };
        if (pseudo[1]) out.tag = pseudo[1];
        return out;
      }
      var textEq = selector.match(/^text=(?:["']([^"']+)["']|([^\s"']+))$/);
      if (textEq) {
        return { text: (textEq[1] || textEq[2] || "").trim() };
      }
      return null;
    }

    // Scan the typical interactive elements for one whose visible text matches.
    // Mirrors matchByText in src/dashboard/lib/picker/protocol.ts (unit-tested).
    // If you change the algorithm here, change it there too.
    function findByText(text, tagFilter) {
      var needle = String(text || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!needle) return null;
      var selector = tagFilter
        ? tagFilter
        : "button, a, [role='button'], label, summary, input[type='submit'], input[type='button']";
      var nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        return null;
      }
      var fallback = null;
      function norm(s) {
        return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
      }
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var ariaLabel =
          el.getAttribute && el.getAttribute("aria-label")
            ? el.getAttribute("aria-label")
            : "";
        // Check each surface independently so a duplicated aria-label
        // doesn't break exact-match detection.
        var surfaces = [el.textContent, el.value, ariaLabel]
          .map(norm)
          .filter(function (s) {
            return s.length > 0;
          });
        if (surfaces.length === 0) continue;
        var exact = false;
        var anySubstring = false;
        for (var j = 0; j < surfaces.length; j++) {
          if (surfaces[j] === needle) {
            exact = true;
            break;
          }
          if (surfaces[j].indexOf(needle) !== -1) anySubstring = true;
        }
        if (exact) return el;
        if (!fallback && anySubstring) fallback = el;
      }
      return fallback;
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

    // Build the most stable selector we can — pure nth-of-type chains
    // break on the smallest DOM change. Preference order:
    //   1. id
    //   2. data-testid / data-test / data-cy
    //   3. aria-label
    //   4. name attribute (form fields)
    //   5. text-based pseudo for buttons / links (recognized by the
    //      extension's safeQuery fallback)
    //   6. last resort: tag + :nth-of-type chain
    function buildSelector(el) {
      if (!el || el.nodeType !== 1) return "";
      if (el.id) return `#${cssEscape(el.id)}`;
      const tag = el.tagName.toLowerCase();
      const testId =
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test") ||
        el.getAttribute("data-cy");
      if (testId) return `[data-testid="${cssEscapeAttr(testId)}"]`;
      const aria = el.getAttribute("aria-label");
      if (aria) return `${tag}[aria-label="${cssEscapeAttr(aria)}"]`;
      const name = el.getAttribute("name");
      if (name && (tag === "input" || tag === "textarea" || tag === "select")) {
        return `${tag}[name="${cssEscapeAttr(name)}"]`;
      }
      // Text-based pseudo for buttons / links / submit inputs. Reuses the
      // same recognition path the runtime click handler uses.
      if (tag === "button" || tag === "a" || tag === "summary") {
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        if (text && text.length <= 80) {
          return `${tag}:has-text("${text.replace(/"/g, '\\"')}")`;
        }
      }
      // Last resort — short positional chain anchored on the nearest
      // ancestor with an id / testid / aria-label, capped at 4 hops so
      // we don't bake in a 7-level fragile path.
      const parts = [];
      let node = el;
      for (let hops = 0; hops < 4 && node && node !== document.body; hops++) {
        const cur = node;
        let part = cur.tagName.toLowerCase();
        // Stop at an anchor ancestor and prefix with it.
        if (cur.id) {
          parts.unshift(`#${cssEscape(cur.id)}`);
          return parts.join(" ");
        }
        const ancestorTestId =
          cur.getAttribute && cur.getAttribute("data-testid");
        if (ancestorTestId && hops > 0) {
          parts.unshift(`[data-testid="${cssEscapeAttr(ancestorTestId)}"]`);
          return parts.join(" ");
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => c.tagName === cur.tagName,
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(part);
        node = cur.parentElement;
      }
      return parts.join(" > ");
    }

    // Escape an attribute value for embedding inside a [attr="…"] selector.
    function cssEscapeAttr(value) {
      return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
