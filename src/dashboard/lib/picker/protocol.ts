/**
 * @fileType module
 * @domain picker
 * @pattern message-protocol
 * @ai-summary Shared message contract + types between the dashboard and the
 *   Kody Element Picker browser extension. Mirrors extension/src/content.js.
 */

/** `window.postMessage` discriminators. Mirrored in extension/src/content.js. */
export const PICKER_PAGE_SOURCE = "kody-picker:page";
export const PICKER_EXT_SOURCE = "kody-picker:ext";

/** A DOM element the user clicked inside the preview iframe. */
export interface PickedElement {
  /** Best-effort CSS selector (id-anchored, else nth-of-type path). */
  selector: string;
  tagName: string;
  id: string | null;
  classes: string[];
  /** Trimmed, whitespace-collapsed text content (capped). */
  text: string;
  attributes: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** URL of the frame the element lives in. */
  url: string;
}

/** Messages the dashboard page sends to the extension bridge. */
export type PickerPageMessage =
  | { source: typeof PICKER_PAGE_SOURCE; type: "ping" }
  | { source: typeof PICKER_PAGE_SOURCE; type: "arm" }
  | { source: typeof PICKER_PAGE_SOURCE; type: "disarm" };

/** Messages the extension bridge sends back to the dashboard page. */
export type PickerExtMessage =
  | { source: typeof PICKER_EXT_SOURCE; type: "pong"; version: string }
  | { source: typeof PICKER_EXT_SOURCE; type: "armed" }
  | { source: typeof PICKER_EXT_SOURCE; type: "disarmed" }
  | { source: typeof PICKER_EXT_SOURCE; type: "selected"; element: PickedElement };

/**
 * Short, chip-friendly label for a picked element, e.g. `<button#submit.btn>`.
 * Capped so a long class list doesn't blow out the composer chip.
 */
export function formatPickedElementLabel(el: PickedElement): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classes.length ? `.${el.classes[0]}` : "";
  return `<${el.tagName}${id}${cls}>`;
}

/**
 * Render a picked element as a chat-ready context block. Kept here (not in the
 * hook) so any surface can format selections identically.
 */
export function formatPickedElement(el: PickedElement): string {
  const lines: string[] = ["Selected element from the preview:"];
  const classes = el.classes.length ? `.${el.classes.join(".")}` : "";
  lines.push(`- Tag: \`<${el.tagName}${el.id ? `#${el.id}` : ""}${classes}>\``);
  lines.push(`- Selector: \`${el.selector}\``);
  if (el.text) lines.push(`- Text: "${el.text}"`);

  const interestingAttrs = Object.entries(el.attributes).filter(
    ([name]) => !["class", "id", "style"].includes(name),
  );
  if (interestingAttrs.length) {
    const rendered = interestingAttrs
      .slice(0, 8)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    lines.push(`- Attributes: \`${rendered}\``);
  }
  lines.push(`- URL: ${el.url}`);
  return lines.join("\n");
}
