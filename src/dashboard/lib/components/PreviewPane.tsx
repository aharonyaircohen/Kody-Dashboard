/**
 * @fileType component
 * @domain preview
 * @pattern preview-pane
 * @ai-summary Compatibility wrapper for the shared PreviewBrowser. Existing
 * Views and Vibe callers keep using PreviewPane while browser behavior lives
 * in one component.
 */
"use client";

import { PreviewBrowser, type PreviewBrowserProps } from "./PreviewBrowser";

export type PreviewPaneProps = PreviewBrowserProps;

export function PreviewPane(props: PreviewPaneProps) {
  return <PreviewBrowser {...props} />;
}
