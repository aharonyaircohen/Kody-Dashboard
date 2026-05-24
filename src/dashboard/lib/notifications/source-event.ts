/**
 * @fileType utility
 * @domain kody
 * @pattern notification-source-event
 * @ai-summary One normalizer for GitHub webhook payloads. Historically each
 *   notification spine parsed the raw payload itself: the mention/inbox spine
 *   (`push/mention-dispatch.ts`), the rules spine (`notifications-dispatch.ts`),
 *   and the staff-trigger spine each had their own `extractEvent`/`buildPrContext`
 *   reading the same fields three different ways. This module is the single
 *   source of truth: `buildSourceEvent` turns any supported webhook into a
 *   `SourceEvent` (a channel-agnostic, fully-typed shape), and each consumer
 *   applies its OWN routing predicate on top (the mention spine wants
 *   `opened`/`created`/`edited`; the rules spine wants `pull_request: closed`
 *   merged deploy PRs — so gating stays per-consumer, only the parsing is shared).
 *
 *   Pure and side-effect free → unit-tested in isolation.
 */

export type ThreadType =
  | "Issue"
  | "PullRequest"
  | "Discussion"
  | "Commit"
  | "";

/** Channels are Discussions whose title starts with this marker. */
export const CHANNEL_TITLE_PREFIX = "#";

/**
 * The pull-request slice of a webhook, present whenever the payload carries a
 * `pull_request` object (pull_request, pull_request_review,
 * pull_request_review_comment). Drives the rules spine's templates
 * (`deploy_pr_merged`, etc.) so it never has to re-read the raw payload.
 */
export interface SourcePr {
  number?: number;
  merged: boolean;
  title: string;
  body: string;
  url: string;
  author?: string;
}

/**
 * A GitHub webhook normalized into a channel-agnostic event. Carries the
 * superset of fields every spine needs; consumers pick what they use and gate
 * on `eventType`/`action`/`threadType` themselves.
 */
export interface SourceEvent {
  /** Raw GitHub webhook event name, e.g. `issue_comment`. */
  eventType: string;
  /** `payload.action`, or `""` when the event has none. */
  action: string;
  repoFullName: string;
  owner: string;
  repo: string;
  /** The text body that may carry `@mentions` (comment/review/issue/pr/discussion). */
  body: string;
  author?: string;
  /** True when the author is a GitHub App / bot (`user.type === "Bot"`). */
  authorIsBot: boolean;
  title: string;
  /** Canonical `html_url` of the artifact — the deep-link target. */
  url: string;
  /**
   * The thread number this event belongs to — issue/PR number for issue & PR
   * events and their comments/reviews, discussion number for discussions.
   * `undefined` for `commit_comment` (commits have no single-thread anchor).
   */
  number?: number;
  threadType: ThreadType;
  /**
   * Set only for `#`-titled discussion comments (messaging channels). Channel
   * messages broadcast to every subscriber and deep-link into `/messages`.
   */
  channel?: { number: number; commentId?: number };
  /** Present whenever the payload carried a `pull_request` object. */
  pr?: SourcePr;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

function login(holder: Record<string, unknown> | undefined): string | undefined {
  return userInfo(holder).login;
}

function userInfo(holder: Record<string, unknown> | undefined): {
  login?: string;
  isBot: boolean;
} {
  const u = obj(holder?.user);
  const l = u?.login;
  return {
    login: typeof l === "string" ? l : undefined,
    isBot: u?.type === "Bot",
  };
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function buildPr(payload: Record<string, unknown>): SourcePr | undefined {
  const pr = obj(payload.pull_request);
  if (!pr) return undefined;
  return {
    number: typeof pr.number === "number" ? pr.number : undefined,
    merged: pr.merged === true,
    title: str(pr.title),
    body: str(pr.body),
    url: str(pr.html_url),
    author: login(pr),
  };
}

/**
 * Normalize a GitHub webhook into a `SourceEvent`. Returns `null` only when the
 * event type is not one we ever route or the repo is missing — it does NOT
 * apply action filters (that's each consumer's job), so a `pull_request:closed`
 * still produces an event for the rules spine even though the mention spine
 * will reject it.
 */
export function buildSourceEvent(
  eventType: string,
  payload: Record<string, unknown>,
): SourceEvent | null {
  const repository = obj(payload.repository);
  const ownerObj = obj(repository?.owner);
  const owner = str(ownerObj?.login);
  const repo = str(repository?.name);
  const repoFullName =
    str(repository?.full_name) || (owner && repo ? `${owner}/${repo}` : "");
  if (!repoFullName) return null;

  const [fnOwner, fnRepo] = repoFullName.split("/");
  const action = str(payload.action);
  const pr = buildPr(payload);

  const base = {
    eventType,
    action,
    repoFullName,
    owner: owner || fnOwner || "",
    repo: repo || fnRepo || "",
    ...(pr ? { pr } : {}),
  };

  switch (eventType) {
    case "issue_comment":
    case "pull_request_review_comment":
    case "commit_comment": {
      const comment = obj(payload.comment);
      const issue = obj(payload.issue);
      const who = userInfo(comment);
      const threadType: ThreadType =
        eventType === "commit_comment"
          ? "Commit"
          : eventType === "pull_request_review_comment" || issue?.pull_request
            ? "PullRequest"
            : "Issue";
      // `commit_comment` has no issue/PR thread; the others anchor to the
      // issue (issue_comment) or the PR (review comment).
      const number =
        eventType === "pull_request_review_comment"
          ? num(pr?.number)
          : eventType === "issue_comment"
            ? num(issue?.number)
            : undefined;
      return {
        ...base,
        body: str(comment?.body),
        author: who.login,
        authorIsBot: who.isBot,
        url: str(comment?.html_url),
        title: str(issue?.title) || str(pr?.title),
        number,
        threadType,
      };
    }

    case "pull_request_review": {
      const review = obj(payload.review);
      const who = userInfo(review);
      return {
        ...base,
        body: str(review?.body),
        author: who.login,
        authorIsBot: who.isBot,
        url: str(review?.html_url),
        title: str(pr?.title),
        number: num(pr?.number),
        threadType: "PullRequest",
      };
    }

    case "issues": {
      const issue = obj(payload.issue);
      const who = userInfo(issue);
      return {
        ...base,
        body: str(issue?.body),
        author: who.login,
        authorIsBot: who.isBot,
        url: str(issue?.html_url),
        title: str(issue?.title),
        number: num(issue?.number),
        threadType: "Issue",
      };
    }

    case "pull_request": {
      const who = userInfo(obj(payload.pull_request));
      return {
        ...base,
        body: pr?.body ?? "",
        author: pr?.author,
        authorIsBot: who.isBot,
        url: pr?.url ?? "",
        title: pr?.title ?? "",
        number: pr?.number,
        threadType: "PullRequest",
      };
    }

    case "discussion": {
      const disc = obj(payload.discussion);
      const who = userInfo(disc);
      return {
        ...base,
        body: str(disc?.body),
        author: who.login,
        authorIsBot: who.isBot,
        url: str(disc?.html_url),
        title: str(disc?.title),
        number: num(disc?.number),
        threadType: "Discussion",
      };
    }

    case "discussion_comment": {
      const comment = obj(payload.comment);
      const disc = obj(payload.discussion);
      const who = userInfo(comment);
      const title = str(disc?.title);
      const discNumber = num(disc?.number);
      const commentId = num(comment?.id);
      const isChannel =
        title.startsWith(CHANNEL_TITLE_PREFIX) && discNumber !== undefined;
      return {
        ...base,
        body: str(comment?.body),
        author: who.login,
        authorIsBot: who.isBot,
        url: str(comment?.html_url),
        title,
        number: discNumber,
        threadType: "Discussion",
        ...(isChannel ? { channel: { number: discNumber, commentId } } : {}),
      };
    }

    default:
      return null;
  }
}
