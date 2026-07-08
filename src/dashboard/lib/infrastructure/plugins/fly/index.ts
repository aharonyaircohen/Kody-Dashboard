/**
 * @fileType plugin
 * @domain infrastructure
 * @pattern fly-infrastructure-plugin
 * @ai-summary Fly plugin registration. This is the only infrastructure layer
 *   module that chooses Fly as an installed provider.
 */

import type {
  InfrastructurePlugin,
  InfrastructureProviderSelection,
  ServerContextBase,
  ServerProvider,
} from "@dashboard/lib/infrastructure/contracts";
import { flyDeploymentProvider } from "./deployments";
import { flyServerProvider } from "./servers";

export const flyInfrastructurePlugin: InfrastructurePlugin = {
  id: "fly",
  providers: {
    servers: flyServerProvider as ServerProvider<
      ServerContextBase,
      unknown,
      unknown,
      unknown,
      unknown
    >,
    deployments: flyDeploymentProvider,
  },
};

export const flyInfrastructureSelection: InfrastructureProviderSelection = {
  servers: flyInfrastructurePlugin.id,
  deployments: flyInfrastructurePlugin.id,
};
