/**
 * @fileoverview Unit coverage for durable saved terminal snapshots.
 * @testFramework vitest
 * @domain terminal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRepo = vi.hoisted(() => ({
  readStateText: vi.fn(),
  writeStateText: vi.fn(),
}));

vi.mock("@dashboard/lib/state-repo", () => ({
  readStateText: stateRepo.readStateText,
  writeStateText: stateRepo.writeStateText,
}));

vi.mock("@dashboard/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  SAVED_TERMINAL_OUTPUT_LIMIT,
  savedTerminalSessionsPath,
} from "@dashboard/lib/terminal/saved-session-types";
import {
  deleteSavedTerminalSession,
  readSavedTerminalSessions,
  upsertSavedTerminalSession,
} from "@dashboard/lib/terminal/saved-session-store";

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saved terminal session store", () => {
  it("reads a per-actor JSON document from the configured state repo", async () => {
    stateRepo.readStateText.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "saved-1",
            name: "Prod runner",
            transport: { type: "fly", app: "runner", machineId: "m1" },
            chatSessionId: "chat-1",
            output: "ready",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });

    const result = await readSavedTerminalSessions(
      fakeOctokit(),
      "acme",
      "widgets",
      "Alice",
    );

    expect(result.doc.sessions).toHaveLength(1);
    expect(result.sha).toBe("sha-1");
    expect(stateRepo.readStateText).toHaveBeenCalledWith(
      { marker: "octokit" },
      "acme",
      "widgets",
      savedTerminalSessionsPath("Alice"),
      { headers: { "If-None-Match": "" } },
    );
  });

  it("upserts a named snapshot and caps stored output", async () => {
    stateRepo.readStateText.mockResolvedValue(null);
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });

    const result = await upsertSavedTerminalSession(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
      {
        name: "Runner tail",
        transport: { type: "local" },
        chatSessionId: "chat-1",
        cwd: "/repo",
        shell: "zsh",
        output: "x".repeat(SAVED_TERMINAL_OUTPUT_LIMIT + 20),
      },
      new Date("2026-06-24T01:00:00.000Z"),
    );

    expect(result.session.output).toHaveLength(SAVED_TERMINAL_OUTPUT_LIMIT);
    expect(result.doc.sessions).toHaveLength(1);
    const write = stateRepo.writeStateText.mock.calls[0][0];
    expect(write).toMatchObject({
      owner: "acme",
      repo: "widgets",
      path: savedTerminalSessionsPath("alice"),
      message: "chore(dashboard): save terminal snapshot",
    });
    expect(JSON.parse(write.content)).toMatchObject({
      version: 1,
      sessions: [
        {
          name: "Runner tail",
          chatSessionId: "chat-1",
          savedBy: "alice",
        },
      ],
    });
  });

  it("deletes a saved snapshot without touching other snapshots", async () => {
    stateRepo.readStateText.mockResolvedValue({
      sha: "sha-1",
      content: JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "keep",
            name: "Keep",
            transport: { type: "local" },
            chatSessionId: "chat-1",
            output: "",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
          {
            id: "drop",
            name: "Drop",
            transport: { type: "local" },
            chatSessionId: "chat-2",
            output: "",
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
            savedBy: "alice",
          },
        ],
      }),
    });
    stateRepo.writeStateText.mockResolvedValue({ sha: "sha-2" });

    const result = await deleteSavedTerminalSession(
      fakeOctokit(),
      "acme",
      "widgets",
      "alice",
      "drop",
    );

    expect(result.deleted?.id).toBe("drop");
    expect(result.doc.sessions.map((session) => session.id)).toEqual(["keep"]);
  });
});
