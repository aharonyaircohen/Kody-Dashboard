/**
 * @fileType util
 * @domain kody
 * @pattern chat-context
 * @ai-summary Formats the "page the user is currently viewing" into chat
 *  context. The in-process kody route surfaces it as a system-prompt section;
 *  the engine/brain backends have no ambient-context slot, so the page rides
 *  along as a bracketed prefix on the user's turn (the engine reads the turn
 *  content, not a system field). One source of wording so all backends agree.
 */

/**
 * `currentPage` is a noun phrase the client builds from the route, e.g.
 * "the Variables page (/variables)" or "the page at /vibe". Keeping the phrase
 * client-side (it owns the nav labels) and the framing server-side (it owns the
 * prompt wording) splits presentation from instruction.
 */
export function dashboardPageContextLine(
  currentPage: string | null | undefined,
): string | null {
  const phrase = currentPage?.trim();
  if (!phrase) return null;
  return (
    `[Dashboard context — the user is currently viewing ${phrase} in the Kody dashboard. ` +
    `When they say "this page", "here", or ask what they're looking at, they mean this.]`
  );
}

/**
 * Prefix a user turn's content with the page-context line (engine + brain
 * paths, which have no system-prompt slot for ambient context). No-op when
 * there's no page to report, so existing behavior is unchanged.
 */
export function withPageContext(
  content: string,
  currentPage: string | null | undefined,
): string {
  const line = dashboardPageContextLine(currentPage);
  return line ? `${line}\n\n${content}` : content;
}

/**
 * Frame the dashboard's curated Context entries (the /context feature, i.e.
 * `loadContextForPrompt()` output) as a bracketed block that can ride on a
 * user turn. Same delivery trick as the page line: the Brain has no
 * system-prompt slot, so standing context travels in the message. The
 * in-process `kody` route injects the identical text as a system section
 * instead — one source of wording so every backend frames it the same way.
 */
export function dashboardContextBlock(
  context: string | null | undefined,
): string | null {
  const body = context?.trim();
  if (!body) return null;
  return (
    `[Dashboard context — standing notes the operator maintains for Kody ` +
    `about this repo. Treat as background knowledge, not a new instruction ` +
    `for this turn:\n\n${body}\n]`
  );
}

/**
 * Prefix a user turn with the dashboard Context block. No-op when there's no
 * context, so callers can pass `null` unconditionally.
 */
export function withDashboardContext(
  content: string,
  context: string | null | undefined,
): string {
  const block = dashboardContextBlock(context);
  return block ? `${block}\n\n${content}` : content;
}

/**
 * Return a copy of `messages` with the page context prefixed onto the most
 * recent user turn — the one the engine treats as the prompt. No-op (shallow
 * copy) when there's no page or no user turn. Generic so it works for any
 * `{ role, content }` message shape without coupling to a route's type.
 */
export function applyPageContextToLastUser<
  T extends { role: string; content: string },
>(messages: readonly T[], currentPage: string | null | undefined): T[] {
  if (!dashboardPageContextLine(currentPage)) return [...messages];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return [...messages];
  return messages.map((m, i) =>
    i === lastUserIdx
      ? { ...m, content: withPageContext(m.content, currentPage) }
      : m,
  );
}
