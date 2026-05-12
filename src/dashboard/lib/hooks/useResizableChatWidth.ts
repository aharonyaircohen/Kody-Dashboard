/**
 * @fileType hook
 * @domain layout
 * @pattern resizable-panel
 * @ai-summary Shared resize behaviour for the desktop chat panel that
 *   appears next to every page (dashboard, jobs, reports, settings, …).
 *
 *   Stores the width in localStorage under `kody.chatPanelWidth` so the
 *   user's choice on the dashboard carries over to every internal page
 *   and survives reloads.
 *
 *   Returns:
 *     - `width` — current width in px (suitable for `style={{ width }}`)
 *     - `setWidth` — direct setter (rarely needed; resize handles cover it)
 *     - `startResize` — onMouseDown handler for the resize separator
 *     - `resetToDefault` — onDoubleClick handler that snaps back to ~half viewport
 */
"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const STORAGE_KEY = "kody.chatPanelWidth"
const WIDTH_MIN = 320
const WIDTH_MAX = 1600
const SSR_FALLBACK = 600

function getDefaultWidth(): number {
  if (typeof window === "undefined") return SSR_FALLBACK
  const half = Math.floor(window.innerWidth / 2)
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, half))
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return SSR_FALLBACK
  const stored = Number(window.localStorage.getItem(STORAGE_KEY))
  if (!Number.isFinite(stored) || stored <= 0) {
    return getDefaultWidth()
  }
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, stored))
}

export interface ResizableChatWidth {
  width: number
  setWidth: (next: number) => void
  startResize: (e: React.MouseEvent) => void
  resetToDefault: () => void
}

export function useResizableChatWidth(): ResizableChatWidth {
  const [width, setWidth] = useState<number>(readStoredWidth)
  const isResizingRef = useRef(false)

  // Persist on every change. Cross-page navigation picks up the latest
  // value because internal pages re-mount and call readStoredWidth().
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(width))
    }
  }, [width])

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = "none"
    document.body.style.cursor = "col-resize"

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      const clamped = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, ev.clientX))
      setWidth(clamped)
    }

    const onUp = () => {
      isResizingRef.current = false
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }

    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [])

  const resetToDefault = useCallback(() => {
    setWidth(getDefaultWidth())
  }, [])

  return { width, setWidth, startResize, resetToDefault }
}
