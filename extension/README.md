# Kody Preview Inspector (browser extension)

Pulls live context out of the dashboard preview into Kody chat:

- **Pick element** - hover and click; selector/tag/text/attributes become a chat
  chip.
- **Console errors** - send preview errors and warnings.
- **Failed requests** - send failed preview network calls.
- **Screenshot** - attach a picture of the preview.
- **Speed check** - send TTFB/FCP/LCP/load timings and slowest resources.
- **Record test** - record a click-through flow and turn it into a Playwright
  test chip.

Console/network are captured by a tiny script injected into the page's main
world. Content scripts alone cannot see the page's own `console`, `fetch`, or
`XMLHttpRequest` calls.

## Why An Extension?

The preview is usually a cross-origin iframe. The dashboard page cannot read or
click inside it, but browser extension content scripts can run inside every
frame without touching the previewed app source.

## How It Works

```text
dashboard page -> content.js bridge -> background.js router -> content.js preview frame
```

- `content.js` runs in every frame.
- Top frame role: bridge between dashboard `window.postMessage` and the
  extension background.
- Preview frame role: picker, collector, action runner, and recorder.
- `background.js` routes commands down to frames and results back to the top
  frame bridge.

The message-name contract is mirrored in
`src/dashboard/lib/picker/protocol.ts`; keep them in sync.

## Install

### Chrome, Edge, Brave, Arc, Comet

1. Open `chrome://extensions` or the equivalent Chromium extensions page.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select the `extension/` folder.
4. Reload the dashboard tab.

### Firefox

Firefox uses the same source files with a Firefox-specific manifest.

1. Run `pnpm picker:pack`.
2. Unzip `public/kody-preview-inspector-firefox.zip`.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on** and pick the unzipped `manifest.json`.
5. Reload the dashboard tab.

Firefox temporary add-ons are removed when Firefox restarts. A permanent Firefox
install needs a signed `.xpi` from Mozilla Add-ons or self-distribution.

## Publish To Chrome Web Store

1. Add raster icons and reference them under `icons` plus
   `action.default_icon` in `manifest.json`.
2. Zip the Chrome extension folder contents.
3. Upload at the Chrome Web Store Developer Dashboard.
4. The broad `<all_urls>` host permission triggers extra review; justify that it
   reads only the preview element the user clicks.

Website code cannot install an extension silently for the user. Store install,
browser prompt, or manual developer install is required.
