# Kody Element Picker (browser extension)

A point-and-click element picker for the dashboard's preview. When armed, you
hover the live preview, click an element, and its details (selector, tag, text,
attributes, position) are sent into Kody chat as context.

## Why an extension?

The preview is a **cross-origin** iframe (a Vercel deployment on a different
domain). The browser forbids the dashboard's own page from reading or clicking
inside that iframe. A browser extension is the one thing allowed in — its
content scripts run inside every frame, including cross-origin ones — **without
touching the previewed app's source code**.

## How it works

```
dashboard page ──window.postMessage──▶ content.js (bridge, top frame)
                                              │ chrome.runtime
                                              ▼
                                        background.js (router)
                                              │ chrome.tabs.sendMessage
                                              ▼
                              content.js (picker, preview iframe)
```

- `content.js` runs in every frame and picks a role:
  - **top frame** → _bridge_: relays between the dashboard page and the
    background. Inert on any site that never pings it.
  - **sub-frame** → _picker_: dormant until "arm", then highlight-on-hover +
    click-to-capture.
- `background.js` routes `arm`/`disarm` down to the iframe and the picked
  element back up to the dashboard.

The message-name contract is mirrored in
`src/dashboard/lib/picker/protocol.ts` — keep the two in sync.

## Install (developer / unpacked — works today, no store needed)

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`,
   any Chromium browser).
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select this `extension/` folder.
4. Reload the dashboard tab. The preview toolbar's picker button activates.

Comet, Brave, Arc, and Edge are all Chromium and load this as-is. Firefox and
Safari would need a separate build.

## Publish to the Chrome Web Store (when ready)

1. Add raster icons (16/48/128 px) and reference them under `icons` +
   `action.default_icon` in `manifest.json`.
2. Zip the `extension/` folder contents.
3. Upload at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-time $5 developer fee, Google account required).
4. The broad `<all_urls>` host permission triggers extra review — expect a few
   days and be ready to justify it ("reads the element you click in the
   preview").

Note: a website can never install an extension for the user — the store page +
"Add to Chrome" + the permission prompt are unavoidable, one-time, per user.
