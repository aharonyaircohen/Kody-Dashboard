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
  title: string;
  /** Canonical `html_url` of the artifact — the deep-link target. */
  url: string;
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
  const u = obj(holder?.user);
  const l = u?.login;
  return typeof l === "string" ? l : undefined;
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
      const threadType: ThreadType =
        eventType === "commit_comment"
          ? "Commit"
          : eventType === "pull_request_review_comment" || issue?.pull_request
            ? "PullRequest"
            : "Issue";
      return {
        ...base,
        body: str(comment?.body),
        author: login(comment),
        url: str(comment?.html_url),
        title: str(issue?.title) || str(pr?.title),
        threadType,
      };
    }

    case "pull_request_review": {
      const review = obj(payload.review);
      return {
        ...base,
        body: str(review?.body),
        author: login(review),
        url: str(review?.html_url),
        title: str(pr?.title),
        threadType: "PullRequest",
      };
    }

    case "issues": {
      const issue = obj(payload.issue);
      return {
        ...base,
        body: str(issue?.body),
        author: login(issue),
        url: str(issue?.html_url),
        title: str(issue?.title),
        threadType: "Issue",
      };
    }

    case "pull_request": {
      return {
        ...base,
        body: pr?.body ?? "",
        author: pr?.author,
        url: pr?.url ?? "",
        title: pr?.title ?? "",
        threadType: "PullRequest",
      };
    }

    case "discussion": {
      const disc = obj(payload.discussion);
      return {
        ...base,
        body: str(disc?.body),
        author: login(disc),
        url: str(disc?.html_url),
        title: str(disc?.title),
        threadType: "Discussion",
      };
    }

    case "discussion_comment": {
      const comment = obj(payload.comment);
      const disc = obj(payload.discussion);
      const title = str(disc?.title);
      const discNumber = typeof disc?.number === "number" ? disc.number : undefined;
      const commentId = typeof comment?.id === "number" ? comment.id : undefined;
      const isChannel =
        title.startsWith(CHANNEL_TITLE_PREFIX) && discNumber !== undefined;
      return {
        ...base,
        body: str(comment?.body),
        author: login(comment),
        url: str(comment?.html_url),
        title,
        threadType: "Discussion",
        ...(isChannel ? { channel: { number: discNumber, commentId } } : {}),
      };
    }

    default:
      return null;
  }
}
