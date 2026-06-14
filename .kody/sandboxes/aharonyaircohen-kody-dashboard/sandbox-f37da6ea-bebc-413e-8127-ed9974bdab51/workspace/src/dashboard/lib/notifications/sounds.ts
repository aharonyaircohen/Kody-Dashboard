/**
 * @fileType utility
 * @domain kody
 * @pattern notification-system
 * @ai-summary Web Audio API notification sounds — distinct musical signatures per notification type.
 *   Each sound is 0.4–0.9s long, designed to be recognizable without looking at the screen.
 */

import type { NotificationType } from "./types";

/** Play a notification sound matching the type. No external files needed. */
export function playNotificationSound(type: NotificationType): void {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AC();
    const t = ctx.currentTime;
    const seq = SOUND_SIGNATURES[type];
    for (const note of seq) {
      playTone(ctx, t, note);
    }
    // Auto-close context after the longest sequence finishes (~1s)
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch {
    // Audio not supported — silent fallback
  }
}

interface Tone {
  freq: number;
  /** Seconds from sequence start when this tone begins */
  start: number;
  /** Tone length in seconds */
  duration: number;
  /** Peak gain (0–1) */
  volume: number;
  /** Oscillator type — sine = soft, triangle = warm, square/sawtooth = harsh */
  wave?: OscillatorType;
}

/**
 * Per-type sound signatures.
 *
 * Design intent:
 * - Success/positive (completed, merged, pr-ready) → ascending notes, major intervals, bright
 * - Failure/warning (failed, build-error) → descending notes, minor intervals, lower freq
 * - Attention (gate-waiting, task-assigned) → two-pulse alert at attention frequencies
 * - Activity (started, retry, stage-change) → short, single soft tone
 * - Communication (chat-response) → gentle two-tone "blip"
 *
 * Frequencies use the standard equal-tempered scale (A4 = 440Hz).
 */
const SOUND_SIGNATURES: Record<NotificationType, Tone[]> = {
  // ✅ Major arpeggio C5 → E5 → G5, bright and conclusive
  "task-completed": [
    { freq: 523.25, start: 0, duration: 0.14, volume: 0.22, wave: "triangle" },
    {
      freq: 659.25,
      start: 0.12,
      duration: 0.14,
      volume: 0.22,
      wave: "triangle",
    },
    {
      freq: 783.99,
      start: 0.24,
      duration: 0.32,
      volume: 0.26,
      wave: "triangle",
    },
  ],

  // 🎉 Celebratory four-note flourish C5-E5-G5-C6
  "pr-merged": [
    { freq: 523.25, start: 0, duration: 0.1, volume: 0.2, wave: "triangle" },
    { freq: 659.25, start: 0.08, duration: 0.1, volume: 0.2, wave: "triangle" },
    {
      freq: 783.99,
      start: 0.16,
      duration: 0.1,
      volume: 0.22,
      wave: "triangle",
    },
    {
      freq: 1046.5,
      start: 0.24,
      duration: 0.4,
      volume: 0.26,
      wave: "triangle",
    },
  ],

  // 🔍 Bright two-tone "ding!" — G5 → C6
  "pr-ready": [
    { freq: 783.99, start: 0, duration: 0.15, volume: 0.24, wave: "sine" },
    { freq: 1046.5, start: 0.12, duration: 0.42, volume: 0.28, wave: "sine" },
  ],

  // ❌ Descending minor — E5 → C5 → A4 — sad/wrong
  "task-failed": [
    { freq: 659.25, start: 0, duration: 0.18, volume: 0.26, wave: "triangle" },
    {
      freq: 523.25,
      start: 0.16,
      duration: 0.18,
      volume: 0.26,
      wave: "triangle",
    },
    { freq: 440, start: 0.32, duration: 0.4, volume: 0.28, wave: "triangle" },
  ],

  // 🛑 Triple low warning pulse — A3 repeated, more urgent than failed
  "build-error": [
    { freq: 220, start: 0, duration: 0.12, volume: 0.3, wave: "sawtooth" },
    { freq: 220, start: 0.18, duration: 0.12, volume: 0.3, wave: "sawtooth" },
    { freq: 220, start: 0.36, duration: 0.3, volume: 0.32, wave: "sawtooth" },
  ],

  // 🚦 Two attention pulses at 880Hz (urgent but not harsh)
  "gate-waiting": [
    { freq: 880, start: 0, duration: 0.16, volume: 0.26, wave: "sine" },
    { freq: 880, start: 0.24, duration: 0.32, volume: 0.28, wave: "sine" },
  ],

  // 👤 Tap-tap notification — D5 + F5 (soft "you've got mail")
  "task-assigned": [
    { freq: 587.33, start: 0, duration: 0.12, volume: 0.22, wave: "sine" },
    { freq: 698.46, start: 0.16, duration: 0.32, volume: 0.24, wave: "sine" },
  ],

  // 💬 Gentle two-tone "blip" — E5 → G5
  "chat-response": [
    { freq: 659.25, start: 0, duration: 0.1, volume: 0.18, wave: "sine" },
    { freq: 783.99, start: 0.1, duration: 0.22, volume: 0.2, wave: "sine" },
  ],

  // 🔄 Quick rising swoosh — A4 → E5
  "task-started": [
    { freq: 440, start: 0, duration: 0.08, volume: 0.16, wave: "triangle" },
    {
      freq: 659.25,
      start: 0.06,
      duration: 0.22,
      volume: 0.18,
      wave: "triangle",
    },
  ],

  // 🔁 Double tap (subtle "again") — F5 + F5
  "retry-started": [
    { freq: 698.46, start: 0, duration: 0.08, volume: 0.16, wave: "sine" },
    { freq: 698.46, start: 0.14, duration: 0.18, volume: 0.18, wave: "sine" },
  ],

  // ⚙️ Soft single chime — D5 (subtle, low priority)
  "stage-change": [
    { freq: 587.33, start: 0, duration: 0.22, volume: 0.16, wave: "sine" },
  ],
};

function playTone(ctx: AudioContext, sequenceStart: number, tone: Tone): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = tone.wave ?? "sine";
  osc.frequency.value = tone.freq;

  const startAt = sequenceStart + tone.start;
  const endAt = startAt + tone.duration;
  // Soft attack (5ms) + exponential decay → no clicks, more musical
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(tone.volume, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  osc.start(startAt);
  osc.stop(endAt + 0.02);
}
