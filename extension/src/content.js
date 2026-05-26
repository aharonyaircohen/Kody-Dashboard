/**
 * Content script — runs in EVERY frame of EVERY page (the privilege a normal
 * web page doesn't have: it can reach inside a cross-origin preview iframe).
 *
 * One file, two roles decided by frame position:
 *   - Top frame  → BRIDGE. Relays between the dashboard page's window.postMessage
 *                  API and the extension background. Inert on any site that never
 *                  pings it (i.e. everything except the Kody dashboard).
 *   - Sub-frame  → PICKER. Dormant until "arm" arrives; then highlights on hover
 *                  and, on click, captures the element and sends it up.
 *
 * Message contract with the dashboard page (window.postMessage):
 *   page → bridge : { source: "kody-picker:page", type: "ping"|"arm"|"disarm" }
 *   bridge → page : { source: "kody-picker:ext",  type: "pong"|"armed"|"disarmed"|"selected", ... }
 * Keep these strings in sync with src/dashboard/lib/picker/protocol.ts.
 */
(() => {
  "use strict";

  const PAGE_SOURCE = "kody-picker:page";
  const EXT_SOURCE = "kody-picker:ext";
  const VERSION = "0.1.0";

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
      window.postMessage({ source: EXT_SOURCE, ...payload }, window.location.origin);
    };

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== PAGE_SOURCE) return;

      if (data.type === "ping") {
        postToPage({ type: "pong", version: VERSION });
      } else if (data.type === "arm") {
        chrome.runtime.sendMessage({ kind: "arm" }).catch(() => {});
        postToPage({ type: "armed" });
      } else if (data.type === "disarm") {
        chrome.runtime.sendMessage({ kind: "disarm" }).catch(() => {});
        postToPage({ type: "disarmed" });
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.kind === "selected") {
        postToPage({ type: "selected", element: msg.element });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // PICKER (sub-frame / the preview iframe)
  // ---------------------------------------------------------------------------
  function initPicker() {
    let armed = false;
    let box = null;
    let current = null;

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.kind === "arm") arm();
      else if (msg?.kind === "disarm") disarm();
    });

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
      chrome.runtime.sendMessage({ kind: "selected", element: describe(el) }).catch(() => {});
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
  }
})();
