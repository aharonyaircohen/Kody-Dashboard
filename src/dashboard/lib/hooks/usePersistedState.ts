/**
 * @fileType hook
 * @domain layout
 * @pattern persisted-ui-state
 * @ai-summary localStorage-backed useState drop-in for *durable UI
 *             preferences* (collapse/expand of sections, groups, list
 *             rows, tool-call cards) so the dashboard remembers how the
 *             user left it across reloads and route changes.
 *
 *   Mirrors the `useResizableChatWidth` convention: lazy initial read
 *   guarded by `typeof window`, write-through on every change.
 *
 *   Use ONLY for state the user expects to stick. Do NOT use for
 *   transient UI (open dialogs, in-flight loading, streaming) — that
 *   should reset on reload.
 *
 *   Exports:
 *     - `usePersistedState<T>(key, initial)` — any JSON-serialisable value.
 *     - `usePersistedSet(key, initial)`      — `Set<string>` stored as an
 *       array; convenience wrapper for the common "set of expanded ids".
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PREFIX = "kody.ui.";

function storageKey(key: string): string {
  return key.startsWith(PREFIX) ? key : PREFIX + key;
}

function read<T>(key: string, initial: T): T {
  if (typeof window === "undefined") return initial;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    // Missing/corrupt/private-mode — fall back to the supplied default.
    return initial;
  }
}

/**
 * `useState` whose value is persisted under `kody.ui.<key>`. The first
 * render reads localStorage (so a remounted component restores
 * immediately, no flash-then-restore); every subsequent change is
 * written back. Accepts the same updater-function form as `useState`.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
  // `initial` is captured once; changing it later won't reset the store.
  const initialRef = useRef(initial);
  const [value, setValue] = useState<T>(() => read(key, initialRef.current));

  // Re-read when the key changes (e.g. a different task scope) so the
  // component shows that scope's saved state instead of the prior one.
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setValue(read(key, initialRef.current));
    }
  }, [key]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey(key), JSON.stringify(value));
    } catch {
      // Quota/private-mode — UI still updates, just won't survive reload.
    }
  }, [key, value]);

  return [value, setValue];
}

/**
 * `Set<string>` variant — persists as a JSON array. Returns the live set
 * plus a `toggle(id)` helper (the near-universal call site) and a raw
 * `setSet` for bulk ops (expand-all / collapse-all).
 */
export function usePersistedSet(
  key: string,
  initial: Set<string> = new Set(),
): {
  set: Set<string>;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  setSet: (next: Set<string>) => void;
} {
  const [arr, setArr] = usePersistedState<string[]>(key, [...initial]);
  const set = new Set(arr);

  const has = useCallback((id: string) => arr.includes(id), [arr]);

  const toggle = useCallback((id: string) => {
    setArr((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, [setArr]);

  const setSet = useCallback(
    (next: Set<string>) => setArr([...next]),
    [setArr],
  );

  return { set, has, toggle, setSet };
}
