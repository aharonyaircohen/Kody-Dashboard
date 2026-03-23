/**
 * @fileType config
 * @domain kody
 * @pattern mcp-registry
 * @ai-summary Declarative registry for MCP tool providers - enables pluggable MCP integration
 *
 * Format: Add entries to MCP_REGISTRY array. Each MCP is defined with transport config,
 * enablement condition, tool prefix, and optional system prompt extension.
 */

import type { AgentId } from './agents'

// ===========================================
// TYPES
// ===========================================

/** MCP transport configuration */
export type MCPTransportConfig =
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | undefined

/** Configuration for a single MCP provider */
export interface MCPConfig {
  /** Unique identifier for this MCP */
  id: string
  /** Human-readable name */
  name: string
  /** What this MCP provides */
  description: string
  /** Lazy transport config - called at init time (may depend on env vars) */
  transport: () => MCPTransportConfig
  /** Whether this MCP should be initialized */
  enabled: () => boolean
  /** Optional prefix to namespace tool names (prevents collisions) */
  toolPrefix?: string
  /** Init timeout in ms (default: 5000) */
  timeoutMs?: number
  /** Which agents get these tools (default: all agents) */
  scope?: AgentId[]
  /** Additional prompt text when this MCP is active */
  systemPromptExtension?: string
}

/** Health status for a single MCP */
export interface MCPHealthStatus {
  id: string
  name: string
  enabled: boolean
  connected: boolean
  toolCount: number
  lastError?: string
}

// ===========================================
// TRANSPORT BUILDERS
// ===========================================

/** Build HTTP transport config for GitHub MCP */
function buildGitHubTransport(): MCPTransportConfig {
  const token = process.env.GH_PAT || process.env.GITHUB_TOKEN
  return {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }
}

/** Build HTTP transport config for Figma MCP (via local stdio server) */
function buildFigmaTransport(): MCPTransportConfig | undefined {
  if (!process.env.FIGMA_API_KEY) return undefined
  // Port will be selected at runtime by the MCP manager
  return {
    type: 'http',
    url: 'http://127.0.0.1:0/mcp', // Port 0 = let OS pick
  }
}

// ===========================================
// ENABLEMENT CHECKS
// ===========================================

/** Check if GitHub MCP is enabled */
function isGitHubEnabled(): boolean {
  return !!(process.env.GH_PAT || process.env.GITHUB_TOKEN)
}

/** Check if Figma MCP is enabled */
function isFigmaEnabled(): boolean {
  return !!process.env.FIGMA_API_KEY
}

// ===========================================
// REGISTRY
// ===========================================

/**
 * MCP Registry - declarative configuration for all MCP providers.
 * Add new MCPs here. Each entry defines transport, enablement, and scoping.
 */
export const MCP_REGISTRY: MCPConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repository browsing, code search, issues, PRs, and GitHub Actions',
    transport: buildGitHubTransport,
    enabled: isGitHubEnabled,
    timeoutMs: 5000,
    scope: undefined, // All agents
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Figma design file analysis and component extraction',
    transport: buildFigmaTransport,
    enabled: isFigmaEnabled,
    timeoutMs: 15000, // Longer timeout for Figma MCP startup
    scope: ['system-architect'], // Only System Architect needs Figma for design analysis
    systemPromptExtension: `
## Figma Integration

You have access to Figma MCP tools for analyzing design files.
When a user shares a Figma URL, use the Figma tools to fetch and analyze the design.

Available Figma tools:
- figma_get_figma_data: Get comprehensive Figma file data
- figma_download_figma_images: Download images from Figma files
`,
  },
  // Future MCPs can be added here:
  // {
  //   id: 'browser',
  //   name: 'Browser',
  //   description: 'Web browsing and content extraction',
  //   transport: buildBrowserTransport,
  //   enabled: isBrowserEnabled,
  //   scope: ['dashboard-manager'],
  // },
]

// ===========================================
// HELPERS
// ===========================================

/** Get all enabled MCPs from the registry */
export function getEnabledMCPs(): MCPConfig[] {
  return MCP_REGISTRY.filter((mcp) => mcp.enabled())
}

/** Get MCPs available for a specific agent */
export function getMCPsForAgent(agentId: AgentId): MCPConfig[] {
  return getEnabledMCPs().filter((mcp) => {
    // If scope is undefined, the MCP is available to all agents
    if (!mcp.scope) return true
    // Otherwise, check if the agent is in the scope
    return mcp.scope.includes(agentId)
  })
}

/** Get MCP config by ID */
export function getMCPById(id: string): MCPConfig | undefined {
  return MCP_REGISTRY.find((mcp) => mcp.id === id)
}

/** Get all unique agent IDs that have any MCPs scoped to them */
export function getScopedAgents(): AgentId[] {
  const agents = new Set<AgentId>()
  for (const mcp of MCP_REGISTRY) {
    if (mcp.scope) {
      mcp.scope.forEach((a) => agents.add(a))
    }
  }
  return Array.from(agents)
}
