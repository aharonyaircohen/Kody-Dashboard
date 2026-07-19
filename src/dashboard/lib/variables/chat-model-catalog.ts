/**
 * @fileType utility
 * @domain chat
 * @pattern model-catalog
 * @ai-summary Composes Dashboard's configured chat models with its embedded
 *   OpenRouter Free model.
 */

import {
  PROVIDER_PRESETS,
  type ChatModel,
} from "@dashboard/lib/variables/models";

export const KODY_OPENROUTER_FREE_CHAT_MODEL: Readonly<ChatModel> =
  Object.freeze({
    id: "openrouter/free",
    label: "OpenRouter Free",
    provider: "openrouter",
    protocol: "openai",
    baseURL: PROVIDER_PRESETS.openrouter.baseURL,
    modelName: "openrouter/free",
    apiKeySecret: PROVIDER_PRESETS.openrouter.keyHint,
    enabled: true,
    default: true,
    engineDefault: false,
  });

export interface CatalogModel {
  id: string;
  enabled?: boolean;
  default?: boolean;
}

/**
 * Add the embedded model while preserving explicit user configuration.
 * An enabled persisted default always beats the embedded fallback.
 */
export function composeChatModelCatalog<T extends CatalogModel>(
  configuredModels: readonly T[],
  builtInModel: T,
): T[] {
  const configured = [...configuredModels];
  const sameId = configured.find((model) => model.id === builtInModel.id);
  const hasExplicitDefault = configured.some(
    (model) => model.enabled !== false && model.default === true,
  );
  const embedded = sameId ?? {
    ...builtInModel,
    default: !hasExplicitDefault,
  };

  return [
    embedded as T,
    ...configured.filter((model) => model.id !== builtInModel.id),
  ];
}
