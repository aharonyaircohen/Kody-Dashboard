# Preview Inspector (browser extension)

Preview Inspector lets you pull live context out of a PR/Vibe preview into Kody
chat:

- **Pick element** - click any element; selector, tag, text, and attributes
  become a chat chip.
- **Console errors** - send errors/warnings the preview logged.
- **Failed requests** - send the preview's failed network calls.
- **Screenshot** - attach a picture of the preview.
- **Speed check** - send load timings plus slowest resources.
- **Record test** - record a click-through flow and turn it into a Playwright
  test chip.

The dashboard page cannot read a cross-origin preview iframe by itself. The
browser extension can run content scripts inside the preview frame without
changing the previewed app's code.

## Download & Install

The extension is distributed as a browser download that you load yourself. The
dashboard downloads the Chrome zip in Chromium browsers and the Firefox zip in
Firefox.

1. Click **Get picker** in the preview toolbar, or download directly:
   - Chromium: [`/kody-element-picker.zip`](/kody-element-picker.zip)
   - Firefox:
     [`/kody-preview-inspector-firefox.zip`](/kody-preview-inspector-firefox.zip)
2. Unzip the downloaded file somewhere you will keep it.
3. Open the browser extension tools:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
   - Comet / Arc / other Chromium: equivalent `...://extensions`
   - Firefox: `about:debugging#/runtime/this-firefox`
4. Chromium: turn on **Developer mode**, then click **Load unpacked** and pick
   the unzipped folder.
5. Firefox: click **Load Temporary Add-on** and pick the unzipped
   `manifest.json`.
6. Reload the dashboard tab. The toolbar button switches from **Get picker** to
   **Pick element**.

Firefox temporary add-ons are removed when Firefox restarts. A permanent Firefox
install needs a signed `.xpi` from Mozilla Add-ons or self-distribution.

## Use It

Open a PR's **Preview** tab or the **Vibe** page with a live preview. The toolbar
shows inspector actions:

- **Pick element** - hover the preview, click the element you mean, then send the
  added chip with your question.
- **Console errors** - sends captured console errors and warnings.
- **Failed requests** - sends failed network requests.
- **Screenshot** - attaches a preview image.
- **Speed** - sends the load-performance snapshot and slowest resources.
- **Record** - records clicks/fills and drops a Playwright test chip into chat.

Console/network capture starts after the preview loads with the extension
installed, so reload the preview after installing.

## Updating

When the extension changes, download the new zip, unzip over the old folder, and
reload the dashboard tab. In Firefox, load the temporary add-on again after a
browser restart.

## Troubleshooting

- **Button still says "Get picker" after installing** - reload the dashboard tab.
- **No green highlight in preview** - make sure the preview loaded, then re-arm
  with **Pick element**.
- **Nothing lands in chat** - confirm the extension is enabled and not paused.

## Maintainers

Source lives in [`extension/`](../extension). Rebuild browser downloads after
changing it:

```bash
pnpm picker:pack
```

Commit regenerated zips so static downloads stay current. See
[`extension/README.md`](../extension/README.md) for the architecture and store
notes.
