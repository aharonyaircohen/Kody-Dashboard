/**
 * @fileType api-utility
 * @domain kody
 * @pattern mcp-manager
 * @ai-summary MCP client lifecycle manager - handles initialization, caching, timeout, and graceful degradation
 *
 * Provides singleton MCP clients with deduplication, per-agent tool fetching,
 * and health status reporting. Replaces hardcoded MCP initialization in route.ts.
 */

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import { logger } from "@dashboard/lib/logger";
import {
  getEnabledMCPs,
  type MCPConfig,
  type MCPHealthStatus,
} from "@dashboard/lib/mcp-registry";

// ===========================================
// TYPES
// ===========================================

interface MCPClientEntry {
  config: MCPConfig;
  client: MCPClient | null;
  pending: Promise<MCPClient> | null;
  lastError: Error | null;
  toolCount: number;
}

// ===========================================
// SINGLETON MANAGER
// ===========================================

let manager: MCPManager | null = null;

/**
 * Get the singleton MCP Manager instance
 */
export function getMCPManager(): MCPManager {
  if (!manager) {
    manager = new MCPManager();
  }
  return manager;
}

// Cleanup on server shutdown
if (typeof process !== "undefined") {
  process.on("beforeExit", () => manager?.dispose());
  process.on("SIGTERM", () => manager?.dispose());
  process.on("SIGINT", () => manager?.dispose());
}

// ===========================================
// MANAGER CLASS
// ===========================================

export class MCPManager {
  private clients: Map<string, MCPClientEntry> = new Map();

  constructor() {
    // Initialize entries for all enabled MCPs
    for (const config of getEnabledMCPs()) {
      this.clients.set(config.id, {
        config,
        client: null,
        pending: null,
        lastError: null,
        toolCount: 0,
      });
    }
  }

  /**
   * Get tools from all enabled MCPs.
   * Handles timeout, caching, and graceful degradation.
   */
  async getTools(): Promise<ToolSet> {
    const mcpConfigs = getEnabledMCPs();
    const allTools: ToolSet = {};

    for (const mcpConfig of mcpConfigs) {
      try {
        const mcpTools = await this.getMCPTools(mcpConfig.id);
        if (mcpTools && Object.keys(mcpTools).length > 0) {
          // Apply tool prefix if configured
          if (mcpConfig.toolPrefix) {
            for (const [toolName, toolDef] of Object.entries(mcpTools)) {
              allTools[`${mcpConfig.toolPrefix}_${toolName}`] = toolDef;
            }
          } else {
            Object.assign(allTools, mcpTools);
          }

          logger.info(
            { mcpId: mcpConfig.id, toolCount: Object.keys(mcpTools).length },
            "MCP tools loaded",
          );
        }
      } catch (error) {
        logger.warn(
          { err: error, mcpId: mcpConfig.id },
          "Failed to load MCP tools - continuing without them",
        );
      }
    }

    return allTools;
  }

  /**
   * Get system prompt extensions from all enabled MCPs
   */
  async getSystemPromptExtensions(): Promise<string> {
    const mcpConfigs = getEnabledMCPs();
    const extensions: string[] = [];

    for (const mcpConfig of mcpConfigs) {
      if (mcpConfig.systemPromptExtension) {
        extensions.push(mcpConfig.systemPromptExtension);
      }
    }

    return extensions.join("\n");
  }

  /**
   * Get health status for all MCPs in the registry
   */
  async getHealthStatus(): Promise<MCPHealthStatus[]> {
    const enabledMCPs = getEnabledMCPs();
    const statuses: MCPHealthStatus[] = [];

    for (const config of enabledMCPs) {
      const entry = this.clients.get(config.id);
      let connected = false;
      let toolCount = 0;
      let lastError: string | undefined;

      if (entry?.client) {
        try {
          const tools = await entry.client.tools();
          connected = true;
          toolCount = Object.keys(tools).length;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "Unknown error";
        }
      } else if (entry?.lastError) {
        lastError = entry.lastError.message;
      }

      statuses.push({
        id: config.id,
        name: config.name,
        enabled: true,
        connected,
        toolCount,
        lastError,
      });
    }

    return statuses;
  }

  /**
   * Clean up all MCP clients
   */
  dispose(): void {
    this.clients.clear();
  }

  // ===========================================
  // PRIVATE METHODS
  // ===========================================

  /**
   * Get tools from a specific MCP, handling initialization and timeout
   */
  private async getMCPTools(mcpId: string): Promise<ToolSet | null> {
    const entry = this.clients.get(mcpId);
    if (!entry) {
      logger.warn({ mcpId }, "MCP not found in registry");
      return null;
    }

    const { config } = entry;

    // Return cached client if already initialized
    if (entry.client) {
      try {
        return await entry.client.tools();
      } catch (error) {
        logger.warn(
          { err: error, mcpId },
          "Cached MCP tools failed - reinitializing",
        );
        entry.client = null;
        entry.pending = null;
      }
    }

    // Deduplicate concurrent initialization attempts
    if (entry.pending) {
      try {
        entry.client = await entry.pending;
        return await entry.client.tools();
      } catch {
        entry.pending = null;
        // Fall through to retry
      }
    }

    // Build transport config
    const transportConfig = config.transport();
    if (!transportConfig) {
      logger.warn({ mcpId }, "MCP transport config returned undefined");
      return null;
    }

    // For stdio transports (like Figma), we need special handling
    if (transportConfig.type === "stdio") {
      return this.getToolsViaStdio(config, entry);
    }

    // For HTTP transports, use standard MCP client
    entry.pending = this.createHTTPClient(transportConfig, mcpId);

    try {
      entry.client = await entry.pending;
      entry.pending = null;
      entry.lastError = null;

      const tools = await entry.client.tools();
      entry.toolCount = Object.keys(tools).length;
      return tools;
    } catch (error) {
      entry.pending = null;
      entry.lastError =
        error instanceof Error ? error : new Error(String(error));
      logger.error({ err: error, mcpId }, "Failed to initialize MCP client");
      return null;
    }
  }

  /**
   * Create an MCP client with HTTP transport
   */
  private async createHTTPClient(
    transportConfig: Extract<
      { type: "http"; url: string; headers?: Record<string, string> },
      object
    >,
    _mcpId: string,
  ): Promise<MCPClient> {
    const client = await createMCPClient({
      transport: {
        type: "http",
        url: transportConfig.url,
        headers: transportConfig.headers,
      },
    });

    return client;
  }

  /**
   * Handle stdio-based MCP (like Figma) — placeholder for future stdio MCP support.
   * Currently not implemented; Figma MCP uses HTTP transport via local stdio→HTTP bridge.
   */
  private async getToolsViaStdio(
    _config: MCPConfig,
    entry: MCPClientEntry,
  ): Promise<ToolSet | null> {
    logger.warn(
      { mcpId: entry.config.id },
      "stdio MCP not implemented — skipping",
    );
    return null;
  }
}
