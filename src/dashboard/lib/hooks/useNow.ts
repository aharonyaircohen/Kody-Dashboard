/**
 * @fileType hook
 * @domain kody
 * @pattern wall-clock-tick
 * @ai-summary Re-renders the caller every `intervalMs` so relative-time
 *   strings ("2m ago", "in 8m") stay fresh without per-component timers.
 *   Use sparingly — every consumer schedules its own setInterval.
 */
import { useEffect, useState } from 'react'

export function useNow(intervalMs: number = 30_000): Date {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
