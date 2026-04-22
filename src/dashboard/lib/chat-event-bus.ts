/**
 * @fileType util
 * @domain kody
 * @pattern in-process-pubsub
 *
 * In-memory pub/sub for chat events. The ingest endpoint publishes; the SSE
 * stream subscribes. Events are also written by the engine to
 * `.kody/events/{id}.jsonl` in git — the stream still polls that file as
 * durable fallback and for rehydration on reconnect.
 *
 * LIMITATION: module-scoped state doesn't cross Vercel serverless instances.
 * An ingest POST routed to instance A won't reach an SSE connection on
 * instance B. When the push path misses, the GitHub-file poll catches up.
 * Upgrade path: swap this for Upstash/Vercel KV pub/sub when traffic warrants.
 */

type Listener = (event: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(sessionId: string, listener: Listener): () => void {
  let set = listeners.get(sessionId);
  if (!set) {
    set = new Set();
    listeners.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(sessionId);
  };
}

export function publish(sessionId: string, event: unknown): void {
  const set = listeners.get(sessionId);
  if (!set) return;
  for (const listener of set) {
    try { listener(event); } catch { /* swallow listener errors */ }
  }
}
