# Element Picker (browser extension)

The element picker lets you **click an element in a PR/Vibe preview** and drop
it into Kody chat as context — selector, tag, text, and attributes. Kody then
knows exactly which part of the UI you mean.

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

1. Open a PR's **Preview** tab (or the **Vibe** page) with a live preview.
2. Click **Pick element**.
3. Hover the preview — elements highlight green. Click the one you mean.
   (Press **Esc** to cancel.)
4. A blue chip appears above the chat composer, e.g. `<button#submit>`. Remove
   it with its ×, or just type your question and send — the element details
   ride along with your message.

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
