# Preview Inspector (browser extension)

The preview inspector lets you pull live context out of a PR/Vibe preview into
Kody chat:

- **Pick element** — click any element; its selector, tag, text, and attributes
  become a chat chip.
- **Console errors** — send the errors/warnings the preview has logged.
- **Failed requests** — send the preview's failed network calls (4xx/5xx/threw).
- **Screenshot** — drop a picture of the preview into chat as an attachment.
- **Speed check** — load timings (TTFB/FCP/LCP/load) plus the slowest resources,
  so Kody can see what's dragging the page.
- **Record a test** — start recording, click through the preview once, stop; your
  actions become a Playwright test chip you (or Kody) can save under `tests/`.

It ships as a small browser extension because the preview is a **cross-origin
iframe**: the dashboard's own page is forbidden by the browser from reaching
inside it, but an extension's content scripts are allowed in — without
touching the previewed app's code.

## Download & install (2 minutes, no store)

The extension is distributed as a zip you load yourself. There's no Chrome Web
Store listing — you install it unpacked.

1. **Download** the picker: click **Get picker** in the preview toolbar, or grab
   [`/kody-element-picker.zip`](/kody-element-picker.zip) directly.
2. **Unzip** it anywhere you'll keep it (don't delete the folder afterwards —
   the browser loads from that location).
3. Open your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Comet / Arc / other Chromium: the equivalent `…://extensions`
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the **unzipped folder** (the one with
   `manifest.json` in it).
6. **Reload the dashboard tab.** The toolbar button switches from "Get picker"
   to **"Pick element"**.

Works on any Chromium browser (Chrome, Edge, Brave, Arc, Comet). Firefox and
Safari aren't supported.

## Use it

Open a PR's **Preview** tab (or the **Vibe** page) with a live preview. The
toolbar shows four inspector actions:

- **Pick element** → hover the preview (elements highlight green), click the one
  you mean (Esc cancels). A blue chip like `<button#submit>` appears above the
  composer; type your question and send — the details ride along.
- **🐞 Console errors** → sends whatever the preview has logged to `console`.
- **📈 Failed requests** → sends the preview's failed network calls.
- **📷 Screenshot** → attaches a picture of the preview to your message.
- **⏱ Speed** → sends a load-performance snapshot + the slowest resources.
- **⏺ Record** → starts recording; click through the preview, then press **Stop**
  to drop a Playwright test of what you did into chat.

Chips and attachments are removable before you send, and chip-only sends (no
typed text) are allowed.

Note: console/network capture starts when the preview loads with the extension
installed — reload the preview after installing so nothing is missed.

## Updating

When the extension changes, re-download the new zip, unzip over the old folder
(or into a new one and re-point "Load unpacked"), and reload the dashboard tab.

## Troubleshooting

- **Button still says "Get picker" after installing** → reload the dashboard
  tab. Content scripts only inject on a fresh page load.
- **No green highlight in the preview** → make sure the preview actually loaded
  (not the "building…" state), then re-arm with "Pick element".
- **Nothing lands in chat** → confirm the extension is enabled on the
  extensions page and not paused.

## For maintainers

The source lives in [`extension/`](../extension). Rebuild the downloadable zip
after changing it:

```bash
pnpm picker:pack   # zips extension/ → public/kody-element-picker.zip
```

Commit the regenerated zip so the static download stays current. See
[`extension/README.md`](../extension/README.md) for the architecture and the
(optional) store-submission path.
