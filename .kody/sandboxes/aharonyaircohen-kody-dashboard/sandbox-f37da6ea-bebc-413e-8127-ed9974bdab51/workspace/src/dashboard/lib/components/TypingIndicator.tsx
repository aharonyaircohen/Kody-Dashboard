/**
 * @fileType ui
 * @domain kody
 * @pattern typing-indicator
 * @ai-summary Animated "<label> is thinking…" three-dot indicator shown in
 *   the chat transcript while an assistant turn is in flight.
 */

export function TypingIndicator({ label }: { label: string }) {
  return (
    <div
      className="flex items-center gap-2 py-1"
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1" aria-hidden="true">
        <span
          className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: "-0.3s" }}
        />
        <span
          className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
          style={{ animationDelay: "-0.15s" }}
        />
        <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" />
      </span>
      <span className="text-xs text-muted-foreground">
        {label} is thinking…
      </span>
    </div>
  );
}
