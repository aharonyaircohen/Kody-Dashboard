/**
 * @fileType util
 * @domain capabilities
 * @pattern capabilities-index
 * @ai-summary Public surface for the capability feature. Capabilities are
 *   stored under state-repo `capabilities/<slug>/` with `profile.json` and
 *   `capability.md`.
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
  type CapabilityFields,
  type CapabilityLanding,
  type CapabilityKind,
  type McpServerSpec,
  type PermissionMode,
} from "./profile";

export {
  deleteCapabilityFile,
  listCapabilityFiles,
  listLocalCapabilityFiles,
  readCapabilityFile,
  readCapabilityFolderFiles,
  readResolvedCapabilityFile,
  writeCapabilityFile,
  writeCapabilityFolderFiles,
  type CapabilityDetail,
  type CapabilityShellScript,
  type CapabilitySkill,
  type CapabilitySummary,
  type WriteCapabilityFolderFilesOptions,
  type WriteCapabilityOptions,
} from "./files";
