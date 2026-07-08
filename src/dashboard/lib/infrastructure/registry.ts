/**
 * @fileType library
 * @domain infrastructure
 * @pattern provider-registry
 * @ai-summary Brand-neutral infrastructure provider registry. Core code owns
 *   selection and validation; provider plugins own vendor details.
 */

import type {
  BrowserProvider,
  DeploymentProvider,
  InfrastructureArea,
  InfrastructurePlugin,
  InfrastructureProviderSelection,
  InfrastructureProviderBase,
  InfrastructureProviderId,
  ServerContextBase,
  ServerProvider,
} from "@dashboard/lib/infrastructure/contracts";

type ProvidersById<TProvider extends InfrastructureProviderBase> = Partial<
  Record<InfrastructureProviderId, TProvider>
>;

function requireProviderId(
  area: InfrastructureArea,
  providerId: InfrastructureProviderId | undefined,
): InfrastructureProviderId {
  if (!providerId) {
    throw new Error(`Missing explicit infrastructure provider for ${area}`);
  }
  return providerId;
}

function getProvider<TProvider extends InfrastructureProviderBase>(
  area: InfrastructureArea,
  providers: ProvidersById<TProvider>,
  providerId: InfrastructureProviderId | undefined,
): TProvider {
  const id = requireProviderId(area, providerId);
  const provider = providers[id];
  if (!provider) {
    throw new Error(`Infrastructure provider ${id} does not support ${area}`);
  }
  return provider;
}

function registerProvider<TProvider extends InfrastructureProviderBase>(
  providers: ProvidersById<TProvider>,
  provider: TProvider | undefined,
): ProvidersById<TProvider> {
  if (!provider) return providers;
  return {
    ...providers,
    [provider.id]: provider,
  };
}

export interface InfrastructureRegistry {
  getServerProvider(): ServerProvider<
    ServerContextBase,
    unknown,
    unknown,
    unknown,
    unknown
  >;
  getDeploymentProvider(): DeploymentProvider<unknown, unknown, unknown, unknown>;
  getBrowserProvider(): BrowserProvider<unknown, unknown, unknown, unknown>;
  getInfrastructureProviders(): {
    servers: ServerProvider<ServerContextBase, unknown, unknown, unknown, unknown>;
    deployments: DeploymentProvider<unknown, unknown, unknown, unknown>;
    browsers?: BrowserProvider<unknown, unknown, unknown, unknown>;
  };
}

export function createInfrastructureRegistry(
  plugins: readonly InfrastructurePlugin[],
  selection: InfrastructureProviderSelection,
): InfrastructureRegistry {
  const serverProviders = plugins.reduce<
    ProvidersById<
      ServerProvider<ServerContextBase, unknown, unknown, unknown, unknown>
    >
  >(
    (providers, plugin) => registerProvider(providers, plugin.providers.servers),
    {},
  );

  const deploymentProviders = plugins.reduce<
    ProvidersById<DeploymentProvider<unknown, unknown, unknown, unknown>>
  >(
    (providers, plugin) =>
      registerProvider(providers, plugin.providers.deployments),
    {},
  );

  const browserProviders = plugins.reduce<
    ProvidersById<BrowserProvider<unknown, unknown, unknown, unknown>>
  >(
    (providers, plugin) => registerProvider(providers, plugin.providers.browsers),
    {},
  );

  return {
    getServerProvider() {
      return getProvider("servers", serverProviders, selection.servers);
    },
    getDeploymentProvider() {
      return getProvider(
        "deployments",
        deploymentProviders,
        selection.deployments,
      );
    },
    getBrowserProvider() {
      return getProvider("browsers", browserProviders, selection.browsers);
    },
    getInfrastructureProviders() {
      return {
        servers: this.getServerProvider(),
        deployments: this.getDeploymentProvider(),
        ...(selection.browsers
          ? { browsers: this.getBrowserProvider() }
          : {}),
      };
    },
  };
}
