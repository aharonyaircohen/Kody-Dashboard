/**
 * @fileType util
 * @domain capabilities
 * @pattern capabilities-index
 * @ai-summary Public surface for the capability feature. Capabilities are
 *   stored under state-repo `capabilities/<slug>/` with `profile.json` and
 *   `capability.md`; legacy agentActions remain exported from
 *   `@dashboard/lib/agent-actions`.
 */

export {
  CAPABILITY_KINDS,
  COMMON_TOOLS,
  DEFAULT_CAPABILITY_KIND,
  PERMISSION_MODES,
  appendContract,
  composeProfile,
  contractFor,
  descriptionFromInstructions,
  fieldsFromProfile,
  isCapabilityKind,
  isValidSlug,
  mcpAllowToken,
  serializeProfile,
  slugFromName,
  stripContract,
  validateProfile,
  type AgentActionFields,
  type AgentActionLanding,
  type CapabilityKind,
  type McpServerSpec,
  type PermissionMode,
} from "../agent-actions/profile";

export {
  deleteCapabilityFile,
  listCapabilityFiles,
  listLocalCapabilityFiles,
  readCapabilityFile,
  readCapabilityFolderFiles,
  readResolvedCapabilityFile,
  writeCapabilityFile,
  writeCapabilityFolderFiles,
  type AgentActionDetail,
  type AgentActionShellScript,
  type AgentActionSkill,
  type AgentActionSummary,
  type WriteAgentActionFolderFilesOptions,
  type WriteAgentActionOptions,
} from "../agent-actions/files";
