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
  const VERSION = "0.4.3";
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
    const markPresence = () => {
      try {
        document.documentElement.dataset.kodyPicker = VERSION;
      } catch {
        /* dataset may be unavailable pre-DOM; ping/pong still covers detection */
      }
    };
    markPresence();
    if (!document.documentElement) {
      document.addEventListener("DOMContentLoaded", markPresence, {
        once: true,
      });
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
      "preview-edit": { kind: "preview-edit" },
      "preview-edit-undo": { kind: "preview-edit-undo" },
      "preview-edit-reset": { kind: "preview-edit-reset" },
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
      } else if (msg?.kind === "preview-edit-result") {
        postToPage({
          type: "preview-edit-result",
          requestId: msg.requestId,
          ok: msg.ok,
          error: msg.error,
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
    // Persisted in sessionStorage so a click that navigates/reloads the preview
    // does not throw away the steps captured before navigation.
    const REC_STATE_KEY = "__kody_recording_state_v1";
    let recording = false;
    let recStartUrl = window.location.href;
    const recSteps = [];
    const previewEditHistory = [];

    // Coalesce count pushes so a chatty app doesn't flood the bridge.
    // NOTE: declared before first use — `pushCounts` reads `countsTimer`, so
    // calling it before this `let` runs would throw (TDZ) and abort init,
    // silently breaking arm/disarm. Keep this before the first pushCounts call.
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

    // Main-world log/network capture is loaded by src/collector.js through
    // the manifest. Keeping it outside inline script injection avoids CSP
    // console errors on strict preview pages such as admin login screens.
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

    // Receive page main-world collector events.
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== COLLECTOR_SOURCE) return;
      if (d.kind === "page-url") {
        chrome.runtime
          .sendMessage({ kind: "page", info: collectPageInfo() })
          .catch(() => {});
        return;
      }
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
      } else if (msg?.kind === "preview-edit") {
        var editResult = applyPreviewEdit(msg.payload);
        if (!editResult) return;
        chrome.runtime
          .sendMessage({
            kind: "preview-edit-result",
            requestId: msg.requestId,
            ok: editResult.ok,
            error: editResult.error,
          })
          .catch(function () {});
      } else if (msg?.kind === "preview-edit-undo") {
        var undoResult = undoPreviewEdit();
        chrome.runtime
          .sendMessage({
            kind: "preview-edit-result",
            requestId: msg.requestId,
            ok: undoResult.ok,
            error: undoResult.error,
          })
          .catch(function () {});
      } else if (msg?.kind === "preview-edit-reset") {
        var resetSelector = msg.payload && msg.payload.selector;
        var resetResult = resetPreviewEdits(resetSelector);
        chrome.runtime
          .sendMessage({
            kind: "preview-edit-result",
            requestId: msg.requestId,
            ok: resetResult.ok,
            error: resetResult.error,
          })
          .catch(function () {});
      } else if (msg?.kind === "record-start") {
        startRecording();
      } else if (msg?.kind === "record-stop") {
        chrome.runtime
          .sendMessage({
            kind: "recording",
            requestId: msg.requestId,
            steps: recSteps.slice(),
            url: recStartUrl || window.location.href,
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
      const el = pickElementFromPoint(e);
      if (!el) return;
      current = el;
      drawBox(el);
    }

    function onClick(e) {
      if (!armed) return;
      // Stop the click from activating the page (links, buttons, etc.).
      e.preventDefault();
      e.stopPropagation();
      const el = pickElementFromPoint(e) || current;
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
      if (recording) {
        document.removeEventListener("click", onRecClick, true);
        document.removeEventListener("change", onRecChange, true);
      }
      recording = true;
      recStartUrl = window.location.href;
      recSteps.length = 0;
      persistRecording();
      document.addEventListener("click", onRecClick, true);
      document.addEventListener("change", onRecChange, true);
      pushRecCount();
    }

    function stopRecording() {
      recording = false;
      document.removeEventListener("click", onRecClick, true);
      document.removeEventListener("change", onRecChange, true);
      persistRecording();
    }

    function onRecClick(e) {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      recSteps.push({
        type: "click",
        selector: buildSelector(el),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      });
      persistRecording();
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
      persistRecording();
      pushRecCount();
    }

    function pushRecCount() {
      chrome.runtime
        .sendMessage({ kind: "rec-count", count: recSteps.length })
        .catch(() => {});
    }

    function persistRecording() {
      try {
        if (!recording) {
          sessionStorage.removeItem(REC_STATE_KEY);
          return;
        }
        sessionStorage.setItem(
          REC_STATE_KEY,
          JSON.stringify({
            recording: true,
            url: recStartUrl,
            steps: recSteps.slice(),
          }),
        );
      } catch (e) {
        /* private mode / blocked storage — recording still works in memory */
      }
    }

    function restoreRecording() {
      var raw = null;
      try {
        raw = sessionStorage.getItem(REC_STATE_KEY);
      } catch (e) {
        return;
      }
      if (!raw) return;
      var saved = null;
      try {
        saved = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (!saved || saved.recording !== true || !Array.isArray(saved.steps)) {
        return;
      }
      recording = true;
      recStartUrl =
        typeof saved.url === "string" ? saved.url : window.location.href;
      recSteps.length = 0;
      saved.steps.forEach(function (step) {
        recSteps.push(step);
      });
      document.addEventListener("click", onRecClick, true);
      document.addEventListener("change", onRecChange, true);
      pushRecCount();
    }

    restoreRecording();

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
            var beforeBodyLen =
              (document.body && document.body.innerHTML.length) || 0;
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
          return resolve({
            ok: false,
            error: String(err && err.message ? err.message : err),
          });
        }
      });
    }

    function applyPreviewEdit(payload) {
      try {
        if (!payload || typeof payload.selector !== "string") {
          return { ok: false, error: "missing selector" };
        }
        var mutation = payload.mutation;
        if (!mutation || typeof mutation.op !== "string") {
          return { ok: false, error: "missing edit operation" };
        }
        var target = safeQuery(payload.selector);
        if (!target) return null;
        if (!(target instanceof Element)) {
          return { ok: false, error: "target is not an element" };
        }

        var undo = null;
        if (mutation.op === "style") {
          if (
            !(target instanceof HTMLElement || target instanceof SVGElement)
          ) {
            return { ok: false, error: "target cannot be styled" };
          }
          var styles = mutation.styles || {};
          var previousStyles = {};
          Object.keys(styles).forEach(function (name) {
            previousStyles[name] = target.style[name] || "";
          });
          undo = function () {
            Object.keys(previousStyles).forEach(function (name) {
              target.style[name] = previousStyles[name];
            });
          };
          Object.keys(styles).forEach(function (name) {
            target.style[name] = String(styles[name] || "");
          });
        } else if (mutation.op === "text") {
          var previousText = target.textContent;
          undo = function () {
            target.textContent = previousText;
          };
          target.textContent = String(mutation.value || "");
        } else if (mutation.op === "attribute") {
          var attrName = String(mutation.name || "");
          if (!/^(href|src|alt)$/.test(attrName)) {
            return { ok: false, error: "unsupported attribute" };
          }
          var hadAttr = target.hasAttribute(attrName);
          var previousAttr = target.getAttribute(attrName);
          undo = function () {
            if (hadAttr) target.setAttribute(attrName, previousAttr || "");
            else target.removeAttribute(attrName);
          };
          target.setAttribute(attrName, String(mutation.value || ""));
        } else if (mutation.op === "hide") {
          var previousDisplay = target.style.display || "";
          undo = function () {
            target.style.display = previousDisplay;
          };
          target.style.display = "none";
        } else if (mutation.op === "duplicate") {
          var clone = target.cloneNode(true);
          undo = function () {
            if (clone.parentNode) clone.parentNode.removeChild(clone);
          };
          if (target.parentNode) {
            target.parentNode.insertBefore(clone, target.nextSibling);
          } else {
            return { ok: false, error: "target has no parent" };
          }
        } else if (mutation.op === "remove") {
          var parent = target.parentNode;
          var next = target.nextSibling;
          undo = function () {
            if (!parent) return;
            parent.insertBefore(
              target,
              next && next.parentNode === parent ? next : null,
            );
          };
          if (parent) parent.removeChild(target);
          else return { ok: false, error: "target has no parent" };
        } else {
          return { ok: false, error: "unsupported edit operation" };
        }

        previewEditHistory.push({
          selector: payload.selector,
          undo: undo,
        });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: String(err && err.message ? err.message : err),
        };
      }
    }

    function pickElementFromPoint(event) {
      try {
        var x = event.clientX;
        var y = event.clientY;
        var stack = document.elementsFromPoint
          ? document.elementsFromPoint(x, y)
          : [];
        var candidates = [];
        for (var i = 0; i < stack.length; i++) {
          var el = stack[i];
          if (!(el instanceof Element)) continue;
          if (el === box) continue;
          var tag = el.tagName ? el.tagName.toLowerCase() : "";
          if (tag === "html" || tag === "body") continue;
          if (!isVisiblePickCandidate(el)) continue;
          candidates.push(el);
        }
        if (candidates.length === 0) {
          return event.target instanceof Element ? event.target : null;
        }
        var focused = candidates.filter(function (el) {
          return !isPageSizedCandidate(el);
        });
        return focused[0] || candidates[0];
      } catch {
        return event.target instanceof Element ? event.target : null;
      }
    }

    function isVisiblePickCandidate(el) {
      try {
        var rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) return false;
        var style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        return true;
      } catch {
        return true;
      }
    }

    function isPageSizedCandidate(el) {
      try {
        var rect = el.getBoundingClientRect();
        var viewportWidth = window.innerWidth || 1;
        var viewportHeight = window.innerHeight || 1;
        return (
          rect.width >= viewportWidth * 0.9 &&
          rect.height >= viewportHeight * 0.9
        );
      } catch {
        return false;
      }
    }

    function undoPreviewEdit() {
      var entry = previewEditHistory.pop();
      if (!entry) return { ok: false, error: "no preview edits to undo" };
      try {
        entry.undo();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: String(err && err.message ? err.message : err),
        };
      }
    }

    function resetPreviewEdits(selector) {
      var didReset = false;
      for (var i = previewEditHistory.length - 1; i >= 0; i--) {
        var entry = previewEditHistory[i];
        if (selector && entry.selector !== selector) continue;
        previewEditHistory.splice(i, 1);
        try {
          entry.undo();
          didReset = true;
        } catch (err) {
          return {
            ok: false,
            error: String(err && err.message ? err.message : err),
          };
        }
      }
      if (!didReset) return null;
      return { ok: true };
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
        var cls =
          el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : "";
        var role = el.getAttribute && el.getAttribute("role");
        return (
          "<" + tag + id + cls + (role ? ' role="' + role + '"' : "") + ">"
        );
      } catch {
        return "<unknown>";
      }
    }

    // Walk up from `el` to the nearest element that's likely to be the
    // real click target (a button, link, role=button, tabindex, [onclick],
    // or anything with cursor:pointer). Falls back to the element itself.
    function closestInteractive(el) {
      if (!(el instanceof Element)) return el;
      var INTERACTIVE_TAGS = {
        BUTTON: 1,
        A: 1,
        INPUT: 1,
        SELECT: 1,
        TEXTAREA: 1,
        SUMMARY: 1,
        LABEL: 1,
      };
      var node = el;
      var hops = 0;
      while (node && hops < 8) {
        if (INTERACTIVE_TAGS[node.tagName]) return node;
        var role = node.getAttribute && node.getAttribute("role");
        if (
          role === "button" ||
          role === "link" ||
          role === "tab" ||
          role === "menuitem"
        )
          return node;
        if (node.getAttribute && node.getAttribute("tabindex") !== null)
          return node;
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
      var needle = String(text || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!needle) return null;
      var selector = tagFilter || "*";
      var nodes = collectAcrossShadow(document, selector);
      var best = null;
      var bestLen = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var raw = (el.textContent || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
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
        var direct = root.querySelectorAll
          ? root.querySelectorAll(selector)
          : [];
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
        var common = {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          view: window,
        };
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
        return String(s || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
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
        h1: 1,
        h2: 1,
        h3: 1,
        h4: 1,
        button: 1,
        a: 1,
        input: 1,
        textarea: 1,
        select: 1,
        label: 1,
        nav: 1,
        main: 1,
        header: 1,
        footer: 1,
        section: 1,
        article: 1,
        form: 1,
        summary: 1,
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
            ' type="' +
            type +
            '"' +
            (ph ? ' label="' + ph.slice(0, 60) + '"' : "");
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
        computedStyles: collectEditableStyles(el),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        url: window.location.href,
      };
    }

    function collectEditableStyles(el) {
      try {
        var s = window.getComputedStyle(el);
        return {
          color: s.color,
          backgroundColor: s.backgroundColor,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          padding: s.padding,
          margin: s.margin,
          gap: s.gap,
          border: s.border,
          borderRadius: s.borderRadius,
          boxShadow: s.boxShadow,
          width: s.width,
          maxWidth: s.maxWidth,
        };
      } catch {
        return {};
      }
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
  }
})();
