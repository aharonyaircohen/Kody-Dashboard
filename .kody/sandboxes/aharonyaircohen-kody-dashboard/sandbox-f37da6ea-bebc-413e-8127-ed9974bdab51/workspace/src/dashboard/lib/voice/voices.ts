/**
 * @fileType config
 * @domain kody
 * @pattern curated-list-with-localstorage-pref
 *
 * Curated Piper voices for the in-chat voice picker, plus the per-user
 * preference store. IDs MUST match the voice models Piper fetches from
 * HuggingFace (diffusionstudio/piper-voices) — these are verified against
 * the @mintplex-labs/piper-tts-web voice list. Switching voice downloads
 * the chosen model (~20MB) on first use, then it's cached in OPFS.
 *
 * English only for now: the voice pipeline routes non-English replies to
 * the browser's speechSynthesis (Piper's bundled voices don't cover e.g.
 * Hebrew), so a Piper voice choice only applies to English speech.
 */
export interface PiperVoice {
  id: string;
  label: string;
}

/** Canonical default — the single source of truth for "no choice made". */
export const DEFAULT_VOICE_ID = "en_US-hfc_female-medium";

export const PIPER_VOICES: PiperVoice[] = [
  { id: "en_US-hfc_female-medium", label: "Female · US" },
  { id: "en_US-hfc_male-medium", label: "Male · US" },
  { id: "en_US-amy-medium", label: "Amy · US" },
  { id: "en_US-ryan-high", label: "Ryan · US" },
  { id: "en_US-lessac-high", label: "Lessac · US" },
  { id: "en_US-kristin-medium", label: "Kristin · US" },
  { id: "en_GB-alan-medium", label: "Alan · UK" },
  { id: "en_GB-cori-high", label: "Cori · UK" },
  { id: "en_GB-jenny_dioco-medium", label: "Jenny · UK" },
];

const STORAGE_KEY = "kody:voice-id";

/** Read the saved voice; falls back to the default if unset/unknown/blocked. */
export function loadVoicePreference(): string {
  if (typeof window === "undefined") return DEFAULT_VOICE_ID;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && PIPER_VOICES.some((x) => x.id === v)) return v;
  } catch {
    // localStorage blocked (private mode / embedded) — use the default.
  }
  return DEFAULT_VOICE_ID;
}

/** Persist the chosen voice (per-user, like the Fly perf tier). */
export function saveVoicePreference(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Best-effort: a blocked store just means the choice won't persist.
  }
}
