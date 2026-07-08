/**
 * @fileType module
 * @domain chat-platform
 * @pattern public-api
 * @ai-summary Public surface of the chat platform layer. Surfaces and
 *   plugins import from here; core never does (lint-enforced zones in
 *   eslint.config.mjs).
 */

export {
  CHAT_CAPABILITIES,
  CONTRIBUTION_CAPABILITIES,
  FULL_GRANT,
  isGranted,
  type ChatCapability,
  type ChatCapabilityGrant,
} from "./capabilities";
export {
  ChatPluginRegistrationError,
  createChatPluginRegistry,
  type ChatPluginRegistry,
  type ChatSendOutcome,
} from "./registry";
export type {
  ChatDisplayMode,
  ChatHostEffect,
  ChatPlugin,
  ChatSendMiddleware,
  ChatSendMiddlewareContext,
  ChatSendMiddlewareResult,
  ChatSessionStateSpec,
  ChatSlotContribution,
  ChatSlotId,
  ChatSlotProps,
  ChatThemeContribution,
} from "./types";
export type {
  ChatAttachmentRef,
  ChatDirective,
  ChatEvent,
  ChatTransport,
  ChatTransportContext,
  ChatTransportStatus,
  ChatTurnInput,
} from "./transport";
export {
  ChatToolRegistrationError,
  createChatServerToolRegistry,
  type ChatPluginServerTools,
  type ChatPluginToolDefinition,
  type ChatServerToolRegistry,
  type ChatToolServerContext,
} from "./tools";
export {
  ChatCatalogCollisionError,
  createChatCatalog,
  directionForLocale,
  type ChatMessageCatalog,
  type ChatTextDirection,
} from "./i18n";
