/**
 * @fileType module
 * @domain chat-platform
 * @pattern transport-contract
 * @ai-summary Public platform surface for the ChatTransport contract. The
 *   actual types live in chat/core/transports/transport-types.ts — the
 *   lint layer zones forbid core → platform imports, and the adapters
 *   (core/transports/{brain,kody-direct,kody-live}.ts) must implement the
 *   contract from inside core. Platform (and plugins) import from here.
 */

export type {
  ChatDirective,
  ChatTransportStatus,
  ChatEvent,
  ChatAttachmentRef,
  ChatTurnInput,
  ChatTransportContext,
  ChatTransport,
} from "../core/transports/transport-types";
