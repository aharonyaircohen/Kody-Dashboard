/**
 * @fileType library
 * @domain infrastructure
 * @pattern installed-infrastructure
 * @ai-summary Runtime infrastructure registry assembled from installed
 *   plugins. App code imports this instead of naming a provider.
 */

import { createInfrastructureRegistry } from "@dashboard/lib/infrastructure/registry";
import {
  flyInfrastructurePlugin,
  flyInfrastructureSelection,
} from "@dashboard/lib/infrastructure/plugins/fly";

export const infrastructureRegistry = createInfrastructureRegistry(
  [flyInfrastructurePlugin],
  flyInfrastructureSelection,
);

export function getServerProvider() {
  return infrastructureRegistry.getServerProvider();
}

export function getDeploymentProvider() {
  return infrastructureRegistry.getDeploymentProvider();
}

export function getBrowserProvider() {
  return infrastructureRegistry.getBrowserProvider();
}

export function getInfrastructureProviders() {
  return infrastructureRegistry.getInfrastructureProviders();
}
