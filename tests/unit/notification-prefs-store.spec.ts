/**
 * Unit tests for the notification preferences file store
 * (src/dashboard/lib/notifications/prefs-store.ts). Tests the read path
 * (with ETag caching) and the write path (CAS with retry on conflict).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  getOwner: vi.fn(() => "acme"),
  getRepo: vi.fn(() => "widgets"),
  getOctokit: vi.fn(),
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@dashboard/lib/engine/config", () => ({
  getEngineConfig: vi.fn().mockResolvedValue({
    config: {
      defaultImplementation: "run",
      state: { repo: "https://github.com/acme/kody-state", path: "widgets" },
    },
    sha: null,
  }),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  getOwner: h.getOwner,
  getRepo: h.getRepo,
  getOctokit: h.getOctokit,
  setGitHubContext: h.setGitHubContext,
  clearGitHubContext: h.clearGitHubContext,
}));

// Silence console.error during tests
vi.spyOn(console, "error").mockReturnValue(undefined);

import {
  readNotificationPrefs,
  writeNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS,
  _resetPrefsCache,
} from "@dashboard/lib/notifications/prefs-store";

// Reset the module-level cache between each test so tests are independent.
beforeEach(() => {
  vi.clearAllMocks();
  _resetPrefsCache();
});

function mockResponse(data: unknown, etag?: string, status = 200) {
  const headers: Record<string, string | undefined> = {};
  if (etag) headers.etag = etag;
  let responseData: unknown =
    data && typeof data === "object" && !Array.isArray(data)
      ? {
          type: "file",
          encoding: "base64",
          ...(data as Record<string, unknown>),
        }
      : data;
  if (
    responseData &&
    typeof responseData === "object" &&
    !Array.isArray(responseData) &&
    !(
      "content" in responseData &&
      (responseData as Record<string, unknown>).content
    )
  ) {
    (responseData as Record<string, unknown>).content = Buffer.from(
      "{}",
      "utf-8",
    ).toString("base64");
  }
  return { data: responseData, headers, status };
}

describe("readNotificationPrefs", () => {
  let mockOctokit: {
    repos: {
      getContent: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getContent: vi.fn(),
      },
    };
    h.getOctokit.mockReturnValue(mockOctokit as unknown);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns defaults when the file does not exist (404)", async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });

    const result = await readNotificationPrefs("alice", "token");
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns parsed prefs when the file exists", async () => {
    const content = Buffer.from(
      JSON.stringify({ version: 1, mutedTypes: ["pr-ready", "chat-response"] }),
    ).toString("base64");
    mockOctokit.repos.getContent.mockResolvedValue(
      mockResponse({ content, sha: "abc123" }, "etag1"),
    );

    const result = await readNotificationPrefs("alice", "token");
    expect(result).toEqual({
      version: 1,
      mutedTypes: ["pr-ready", "chat-response"],
    });
  });

  it("returns defaults for malformed JSON", async () => {
    const content = Buffer.from("not json at all").toString("base64");
    mockOctokit.repos.getContent.mockResolvedValue(
      mockResponse({ content, sha: "abc123" }, "etag1"),
    );

    const result = await readNotificationPrefs("alice", "token");
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it("returns 304 → cached data (free refresh)", async () => {
    const content = Buffer.from(
      JSON.stringify({ version: 1, mutedTypes: ["task-assigned"] }),
    ).toString("base64");
    // First call: success with etag (populates cache)
    mockOctokit.repos.getContent.mockResolvedValueOnce(
      mockResponse({ content, sha: "abc123" }, "etag1"),
    );
    // Second call: 304 Not Modified
    mockOctokit.repos.getContent.mockRejectedValueOnce({ status: 304 });

    const first = await readNotificationPrefs("alice", "token");
    expect(first).toEqual({ version: 1, mutedTypes: ["task-assigned"] });

    // Second call: 304 → cache hit, data returned without body re-read
    const second = await readNotificationPrefs("alice", "token");
    expect(second).toEqual({ version: 1, mutedTypes: ["task-assigned"] });
  });

  it("returns defaults on non-404/non-304 errors with no cache", async () => {
    // No prior successful call → no cache entry
    mockOctokit.repos.getContent.mockRejectedValue({ status: 500 });

    const result = await readNotificationPrefs("bob", "token");
    expect(result).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe("writeNotificationPrefs", () => {
  let mockOctokit: {
    repos: {
      getContent: ReturnType<typeof vi.fn>;
      createOrUpdateFileContents: ReturnType<typeof vi.fn>;
    };
    git: {
      getRef: ReturnType<typeof vi.fn>;
      createRef: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getContent: vi.fn(),
        createOrUpdateFileContents: vi.fn(),
      },
      git: {
        getRef: vi.fn().mockResolvedValue({
          data: { object: { sha: "state-sha" } },
        }),
        createRef: vi.fn(),
      },
    };
    h.getOctokit.mockReturnValue(mockOctokit as unknown);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a new file when no SHA exists (404 on getContent)", async () => {
    // First call: getContent → 404 (file doesn't exist)
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    // Second call: createOrUpdateFileContents → success
    mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({
      status: 201,
    });

    await writeNotificationPrefs("alice", "token", {
      version: 1,
      mutedTypes: ["pr-ready"],
    });

    const createCall =
      mockOctokit.repos.createOrUpdateFileContents.mock.calls[0]![0];
    expect(createCall).toMatchObject({
      path: "widgets/notifications/preferences/alice.json",
      branch: "main",
      message: "feat(notifications): update prefs for alice",
    });
    expect(createCall.sha).toBeUndefined();
  });

  it("updates an existing file when SHA is provided", async () => {
    // getContent returns the existing file with a SHA
    mockOctokit.repos.getContent.mockResolvedValue(
      mockResponse({ sha: "existing-sha", content: "" }),
    );
    mockOctokit.repos.createOrUpdateFileContents.mockResolvedValue({
      status: 200,
    });

    await writeNotificationPrefs("alice", "token", {
      version: 1,
      mutedTypes: ["chat-response", "task-assigned"],
    });

    const createCall =
      mockOctokit.repos.createOrUpdateFileContents.mock.calls[0]![0];
    expect(createCall).toMatchObject({
      sha: "existing-sha",
    });
  });

  it("retries with fresh SHA on CAS conflict (409)", async () => {
    // getContent: first call returns SHA
    mockOctokit.repos.getContent
      .mockResolvedValueOnce(mockResponse({ sha: "sha1", content: "" }))
      // Second call after conflict: returns fresh SHA
      .mockResolvedValueOnce(mockResponse({ sha: "sha2", content: "" }));
    // createOrUpdateFileContents: first → 409 conflict, second → success
    mockOctokit.repos.createOrUpdateFileContents
      .mockRejectedValueOnce({ status: 409 })
      .mockResolvedValueOnce({ status: 200 });

    await writeNotificationPrefs("alice", "token", {
      version: 1,
      mutedTypes: [],
    });

    // Should have retried with sha2
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(
      2,
    );
    const retryCall =
      mockOctokit.repos.createOrUpdateFileContents.mock.calls[1]![0];
    expect(retryCall.sha).toBe("sha2");
  });

  it("throws when write fails after retry", async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    mockOctokit.repos.createOrUpdateFileContents.mockRejectedValue({
      status: 500,
    });

    await expect(
      writeNotificationPrefs("alice", "token", { version: 1, mutedTypes: [] }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
