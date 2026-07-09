/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern xterm-bootstrap
 * @ai-summary xterm bootstrap for the chat terminal surface: lazy-loads
 *   @xterm modules, builds the terminal with the Kody theme, wires the
 *   fit/web-links addons, the custom wheel scroller, and the data/
 *   selection/resize listeners. Extracted from ChatTerminalSurface in
 *   Step 5a (800-line rule); behavior unchanged.
 */
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

import {
  openTerminalWebLink,
  wheelDeltaToTerminalLines,
} from "./terminal-text";

export interface TerminalMountHandlers {
  onData: (data: string) => void;
  onSelectionChange: (selection: string) => void;
  onResize: (cols: number, rows: number) => void;
  isActive: () => boolean;
}

export interface MountedXterm {
  terminal: XTerm;
  fitAddon: XTermFitAddon;
  observer: ResizeObserver;
  disposables: Array<{ dispose: () => void }>;
}

/**
 * Load and mount xterm into `host`. Returns null when `isDisposed()` flips
 * before the lazy imports resolve (the caller unmounted mid-load).
 */
export async function mountChatTerminal(
  host: HTMLElement,
  handlers: TerminalMountHandlers,
  isDisposed: () => boolean,
): Promise<MountedXterm | null> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
  ]);
  if (isDisposed()) return null;

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily:
      "'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 10000,
    theme: {
      background: "#050608",
      foreground: "#d7dde8",
      cursor: "#ffffff",
      black: "#0a0d12",
      blue: "#7aa2f7",
      cyan: "#7dcfff",
      green: "#9ece6a",
      magenta: "#bb9af7",
      red: "#f7768e",
      white: "#c0caf5",
      yellow: "#e0af68",
    },
  });
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openTerminalWebLink(uri);
  });
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(host);
  fitAddon.fit();

  terminal.attachCustomWheelEventHandler((event) => {
    const lines = wheelDeltaToTerminalLines(event, terminal.rows);
    if (lines === 0) return true;
    event.preventDefault();
    event.stopPropagation();
    terminal.scrollLines(event.deltaY > 0 ? lines : -lines);
    return false;
  });

  const disposables: Array<{ dispose: () => void }> = [];
  disposables.push(terminal.onData(handlers.onData));
  disposables.push(
    terminal.onSelectionChange(() => {
      handlers.onSelectionChange(terminal.getSelection());
    }),
  );
  disposables.push(
    terminal.onResize(({ cols, rows }) => handlers.onResize(cols, rows)),
  );

  const observer = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      if (!handlers.isActive()) return;
      fitAddon.fit();
      handlers.onResize(terminal.cols, terminal.rows);
    });
  });
  observer.observe(host);

  return { terminal, fitAddon, observer, disposables };
}
