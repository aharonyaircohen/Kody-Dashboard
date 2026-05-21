/**
 * @fileoverview Unit tests for engine install — verifies kody.config.json creation
 * @testFramework vitest
 * @domain engine-install
 *
 * Tests that installEngine creates kody.config.json with the resolved default
 * model and default executable.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  installEngine,
  type InstallEngineInput,
} from "@dashboard/lib/engine/install";

// ──────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ──────────────────────────────────────────────────────────────────────────────

function createMockOctokit(overrides?: Record<string, unknown>) {
  return {
    rest: {
      repos: {
        getContent: vi.fn().mockResolvedValue({
          data: { content: "", sha: "abc123" },
        }),
        createOrUpdateFileContents: vi.fn().mockResolvedValue({
          data: {
            commit: { sha: "commitsha" },
            content: {
              html_url:
                "https://github.com/example/repo/blob/main/.github/workflows/kody.yml",
            },
          },
        }),
      },
      actions: {
        getRepoPublicKey: vi.fn().mockResolvedValue({
          data: { key: "mock-public-key", key_id: "key-id-123" },
        }),
        createOrUpdateRepoSecret: vi.fn().mockResolvedValue({}),
      },
    },
    ...overrides,
  } as any;
}

/** Spy on every createOrUpdateFileContents call and capture the path + content. */
function captureFileWrites(octokit: ReturnType<typeof createMockOctokit>) {
  const calls: Array<{ path: string; content: string }> = [];
  vi.spyOn(octokit.rest.repos, "createOrUpdateFileContents").mockImplementation(
    async (params: any) => {
      calls.push({
        path: params.path,
        content: Buffer.from(params.content, "base64").toString("utf-8"),
      });
      return {
        data: {
          commit: { sha: "commitsha" },
          content: {
            html_url: `https://github.com/example/repo/blob/main/${params.path}`,
          },
        },
      };
    },
  );
  return {
    calls,
    getByPath: (path: string) => calls.find((c) => c.path === path),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("installEngine", () => {
  describe("kody.config.json creation", () => {
    it("creates kody.config.json at the repo root after the workflow", async () => {
      const octokit = createMockOctokit();
      const { calls, getByPath } = captureFileWrites(octokit);

      const input: InstallEngineInput = {
        octokit,
        owner: "example",
        repo: "my-repo",
        token: "ghp_mocktoken",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      };

      const result = await installEngine(input);

      expect(result.ok).toBe(true);

      // kody.config.json must be created
      const configFile = getByPath("kody.config.json");
      expect(configFile).toBeDefined();
    });

    it("kody.config.json contains executables.default set to run", async () => {
      const octokit = createMockOctokit();
      const { getByPath } = captureFileWrites(octokit);

      const input: InstallEngineInput = {
        octokit,
        owner: "example",
        repo: "my-repo",
        token: "ghp_mocktoken",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      };

      await installEngine(input);

      const configFile = getByPath("kody.config.json");
      expect(configFile).toBeDefined();
      const parsed = JSON.parse(configFile!.content);
      expect(parsed.executables?.default).toBe("run");
    });

    it("kody.config.json contains model.default when variables.json exists with models", async () => {
      const octokit = createMockOctokit();
      const { getByPath } = captureFileWrites(octokit);

      // Simulate variables.json returning a default model
      vi.spyOn(octokit.rest.repos, "getContent").mockImplementation(
        async (params: any) => {
          if (params.path === ".kody/variables.json") {
            const variablesContent = JSON.stringify({
              LLM_MODELS: [
                {
                  id: "example/chat-model",
                  label: "Example Chat Model",
                  provider: "example",
                  protocol: "openai",
                  baseURL: "",
                  modelName: "chat-model",
                  apiKeySecret: "MY_API_KEY",
                  enabled: true,
                  default: true,
                },
              ],
            });
            return {
              data: {
                content: Buffer.from(variablesContent).toString("base64"),
                sha: "varsha",
              },
            };
          }
          return { data: { content: "", sha: "abc123" } };
        },
      );

      const input: InstallEngineInput = {
        octokit,
        owner: "example",
        repo: "my-repo",
        token: "ghp_mocktoken",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      };

      await installEngine(input);

      const configFile = getByPath("kody.config.json");
      expect(configFile).toBeDefined();
      const parsed = JSON.parse(configFile!.content);
      expect(parsed.model?.default).toBe("example/chat-model");
    });

    it("kody.config.json is created even when variables.json does not exist", async () => {
      const octokit = createMockOctokit();
      const { getByPath } = captureFileWrites(octokit);

      // Simulate variables.json not existing (404)
      vi.spyOn(octokit.rest.repos, "getContent").mockImplementation(
        async (params: any) => {
          if (params.path === ".kody/variables.json") {
            const error = new Error("Not Found") as unknown as {
              status: number;
            };
            error.status = 404;
            throw error;
          }
          return { data: { content: "", sha: "abc123" } };
        },
      );

      const input: InstallEngineInput = {
        octokit,
        owner: "example",
        repo: "my-repo",
        token: "ghp_mocktoken",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      };

      const result = await installEngine(input);

      expect(result.ok).toBe(true);

      // kody.config.json should still be created (just without model.default)
      const configFile = getByPath("kody.config.json");
      expect(configFile).toBeDefined();
      const parsed = JSON.parse(configFile!.content);
      expect(parsed.executables?.default).toBe("run");
      expect(parsed.model).toBeUndefined();
    });

    it("upserts kody.config.json (updates if it already exists)", async () => {
      const octokit = createMockOctokit();
      const { getByPath } = captureFileWrites(octokit);

      // Simulate kody.config.json already existing
      vi.spyOn(octokit.rest.repos, "getContent").mockImplementation(
        async (params: any) => {
          if (params.path === "kody.config.json") {
            const existingConfig = JSON.stringify({
              model: { default: "old/model" },
              executables: { default: "old-exec" },
            });
            return {
              data: {
                content: Buffer.from(existingConfig).toString("base64"),
                sha: "existing-sha",
              },
            };
          }
          return { data: { content: "", sha: "abc123" } };
        },
      );

      const input: InstallEngineInput = {
        octokit,
        owner: "example",
        repo: "my-repo",
        token: "ghp_mocktoken",
        hookUrl: "https://dashboard.example.com/api/webhooks/github",
      };

      await installEngine(input);

      const configFile = getByPath("kody.config.json");
      expect(configFile).toBeDefined();
      const parsed = JSON.parse(configFile!.content);
      // Should be updated with new values
      expect(parsed.executables?.default).toBe("run");
    });
  });
});
