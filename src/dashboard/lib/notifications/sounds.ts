/**
 * @fileType utility
 * @domain kody
 * @pattern notification-system
 * @ai-summary Web Audio API notification sounds — distinct per priority level
 */

type SoundProfile = 'high' | 'medium' | 'low'

/** Play a notification sound using Web Audio API. No external files needed. */
export function playNotificationSound(profile: SoundProfile): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()

    if (profile === 'high') {
      // Double beep — urgent
      playBeep(ctx, 900, 0.12, 0, 0.35)
      playBeep(ctx, 900, 0.12, 0.18, 0.35)
    } else if (profile === 'medium') {
      // Single soft chime — pleasant
      playBeep(ctx, 660, 0.2, 0, 0.2)
    } else {
      // Subtle tick — minimal
      playBeep(ctx, 500, 0.08, 0, 0.15)
    }
  } catch {
    // Audio not supported — silent fallback
  }
}

function playBeep(
  ctx: AudioContext,
  freq: number,
  duration: number,
  delay: number,
  volume: number,
): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = freq
  osc.type = 'sine'
  gain.gain.value = volume
  // Fade out to avoid click
  gain.gain.setValueAtTime(volume, ctx.currentTime + delay)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration)
  osc.start(ctx.currentTime + delay)
  osc.stop(ctx.currentTime + delay + duration + 0.01)
}
