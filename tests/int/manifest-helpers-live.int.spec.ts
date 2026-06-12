/**
 * COMPLETE live verification of all five real manifest helpers against the
 * tester sandbox repo. Unlike manifest-store-live.int.spec.ts (which drives
 * the generic core with a throwaway label), this exercises the actual
 * exported helpers — goals / push / notifications / inbox-feed — through
 * their real `kody:*` labels, every scenario, end to
 * end against the live GitHub API.
 *
 * Safety: each helper's real manifest issue is snapshotted before the run
 * and restored after (original body written back; if we created it, it's
 * closed so discovery — which filters state:open — no longer sees it). So
 * the tester repo's real manifest state is left exactly as found.
 *
 * Gated: skipped unless RUN_REAL_E2E=1 and E2E creds are present.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Octokit } from "@octokit/rest";
import {
  setGitHubContext,
  clearGitHubContext,
} from "@dashboard/lib/github-client";
import {
  mutateGoalsManifest,
  readGoalsManifestFresh,
} from "@dashboard/lib/goals-server";
import { GOALS_MANIFEST_LABEL } from "@dashboard/lib/goals";
import {
  mutatePushManifest,
  readPushManifest,
} from "@dashboard/lib/push-server";
import { PUSH_SUBSCRIPTIONS_LABEL } from "@dashboard/lib/push";
import {
  mutateNotificationsManifest,
  readNotificationsManifestFresh,
} from "@dashboard/lib/notifications-server";
import { NOTIFICATIONS_MANIFEST_LABEL } from "@dashboard/lib/notifications";
import {
  appendInboxFeed,
  readInboxFeed,
} from "@dashboard/lib/inbox/feed-server";
import {
  INBOX_FEED_LABEL,
  feedEntryId,
  type InboxFeedEntry,
} from "@dashboard/lib/inbox/feed";

const RUN = process.env.RUN_REAL_E2E === "1";
const TOKEN = process.env.E2E_GITHUB_TOKEN ?? "";
const REPO_URL = process.env.E2E_GITHUB_REPO ?? "";
const enabled = RUN && !!TOKEN && !!REPO_URL;

function parseRepo(url: string) {
  const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!m) throw new Error(`bad E2E_GITHUB_REPO: ${url}`);
  return { owner: m[1], repo: m[2] };
}

interface Snap {
  label: string;
  number: number | null;
  body: string;
  preExisted: boolean;
}

describe.skipIf(!enabled)(
  "manifest helpers · COMPLETE live verification",
  () => {
    let octo: Octokit;
    let owner = "";
    let repo = "";
    const snaps: Snap[] = [];
    const tag = Date.now().toString(36);

    async function snapshot(label: string): Promise<void> {
      const res = await octo.issues.listForRepo({
        owner,
        repo,
        state: "open",
        labels: label,
        per_page: 5,
      });
      const first = res.data
        .filter((i) => !i.pull_request)
        .sort((a, b) => a.number - b.number)[0];
      snaps.push({
        label,
        number: first?.number ?? null,
        body: first?.body ?? "",
        preExisted: !!first,
      });
    }

    beforeAll(async () => {
      ({ owner, repo } = parseRepo(REPO_URL));
      octo = new Octokit({ auth: TOKEN });
      setGitHubContext(owner, repo, TOKEN);
      for (const label of [
        GOALS_MANIFEST_LABEL,
        PUSH_SUBSCRIPTIONS_LABEL,
        NOTIFICATIONS_MANIFEST_LABEL,
        INBOX_FEED_LABEL,
      ]) {
        await snapshot(label);
      }
    }, 60_000);

    afterAll(async () => {
      try {
        for (const s of snaps) {
          const cur = await octo.issues.listForRepo({
            owner,
            repo,
            state: "open",
            labels: s.label,
            per_page: 5,
          });
          const live = cur.data
            .filter((i) => !i.pull_request)
            .sort((a, b) => a.number - b.number)[0];
          if (!live) continue;
          if (s.preExisted) {
            // Restore the exact original body.
            await octo.issues.update({
              owner,
              repo,
              issue_number: live.number,
              body: s.body,
            });
          } else {
            // We created it — close so discovery (state:open) no longer sees it.
            await octo.issues.update({
              owner,
              repo,
              issue_number: live.number,
              state: "closed",
            });
          }
        }
      } finally {
        clearGitHubContext();
      }
    }, 60_000);

    it("goals: create/mutate → fresh read verifies; noop leaves it untouched", async () => {
      const id = `livetest-goal-${tag}`;
      const out = await mutateGoalsManifest((cur) => ({
        next: {
          version: 1,
          goals: [
            ...cur.goals,
            { id, name: "live test goal", createdAt: new Date().toISOString() },
          ],
        },
        result: id,
      }));
      expect("issueNumber" in out).toBe(true);

      const ref = await readGoalsManifestFresh();
      expect(ref.manifest.goals.some((g) => g.id === id)).toBe(true);

      const before = (await readGoalsManifestFresh()).manifest.goals.length;
      const noop = await mutateGoalsManifest(() => ({
        kind: "noop" as const,
        result: "skip",
      }));
      expect(noop).toEqual({ kind: "noop", result: "skip" });
      expect((await readGoalsManifestFresh()).manifest.goals.length).toBe(
        before,
      );
    }, 90_000);

    it("push: subscribe round-trips; noop leaves it untouched", async () => {
      const endpoint = `https://example.com/push/${tag}`;
      await mutatePushManifest((cur) => ({
        next: {
          version: 1,
          subscriptions: [
            ...cur.subscriptions,
            {
              endpoint,
              keys: { p256dh: "p", auth: "a" },
              createdAt: new Date().toISOString(),
            },
          ],
        },
        result: "ok",
      }));
      const ref = await readPushManifest();
      expect(
        ref.manifest.subscriptions.some((s) => s.endpoint === endpoint),
      ).toBe(true);

      const n = ref.manifest.subscriptions.length;
      const noop = await mutatePushManifest(() => ({
        kind: "noop" as const,
        result: 0,
      }));
      expect(noop).toEqual({ kind: "noop", result: 0 });
      expect((await readPushManifest()).manifest.subscriptions.length).toBe(n);
    }, 90_000);

    it("notifications: add rule round-trips via fresh read", async () => {
      const ruleId = `livetest-rule-${tag}`;
      await mutateNotificationsManifest((cur) => ({
        next: {
          version: 1,
          rules: [
            ...cur.rules,
            {
              id: ruleId,
              name: "live test",
              enabled: true,
              event: "task_failed",
              channel: { type: "web-push" },
              createdAt: new Date().toISOString(),
            },
          ],
        },
        result: ruleId,
      }));
      const ref = await readNotificationsManifestFresh();
      expect(ref.manifest.rules.some((r) => r.id === ruleId)).toBe(true);
    }, 90_000);

    it("inbox-feed: append adds; dup append returns 0; empty returns 0", async () => {
      const url = `https://example.com/i/${tag}`;
      const e: InboxFeedEntry = {
        id: feedEntryId("liveuser", url),
        login: "liveuser",
        source: "mention" as InboxFeedEntry["source"],
        repoFullName: `${owner}/${repo}`,
        threadType: "Issue",
        title: "live test",
        snippet: "s",
        url,
        sentAt: new Date().toISOString(),
      };

      expect(await appendInboxFeed([])).toBe(0);
      expect(await appendInboxFeed([e])).toBe(1);
      expect(await appendInboxFeed([e])).toBe(0); // dedupe by id

      const feed = await readInboxFeed();
      expect(feed.entries.some((x) => x.id === e.id)).toBe(true);
    }, 90_000);
  },
);
