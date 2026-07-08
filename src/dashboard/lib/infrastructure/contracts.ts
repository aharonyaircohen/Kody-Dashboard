/**
 * @fileType library
 * @domain infrastructure
 * @pattern provider-contracts
 * @ai-summary Brand-agnostic infrastructure contracts. Kody owns these
 *   concepts; Fly/OpenComputer/Coolify are adapters behind them.
 */

export type InfrastructureProviderId = string;

export type InfrastructureArea = "servers" | "deployments" | "browsers";

export type InfrastructureCapability =
  | "run-work"
  | "claim-warm-runner"
  | "expose-http"
  | "deploy-preview"
  | "wake"
  | "suspend"
  | "destroy"
  | "inventory"
  | "real-browser";

export interface InfrastructureProviderBase {
  id: InfrastructureProviderId;
  area: InfrastructureArea;
  capabilities: ReadonlySet<InfrastructureCapability>;
}

export interface ServerContextBase {
  owner: string;
  repo: string;
  octokit: unknown;
}

export type ServerContextResult<TContext extends ServerContextBase> =
  | { ok: true; context: TContext }
  | { ok: false; error: string; status: number };

export interface ServerProvider<
  TContext extends ServerContextBase,
  TRunInput,
  TRunResult,
  TClaimInput = never,
  TClaimResult = never,
> extends InfrastructureProviderBase {
  area: "servers";
  resolveContext?(input: unknown): Promise<ServerContextResult<TContext>>;
  isAvailable?(context: TContext): boolean;
  run(input: TRunInput): Promise<TRunResult>;
  claimOrRun?(context: TContext, input: TClaimInput): Promise<TClaimResult>;
}

export interface DeploymentProvider<
  TConfig,
  TCreateInput,
  TDeploymentKey,
  TDeploymentInfo,
> extends InfrastructureProviderBase {
  area: "deployments";
  create(input: TCreateInput, config: TConfig): Promise<TDeploymentInfo>;
  get(key: TDeploymentKey, config: TConfig): Promise<TDeploymentInfo | null>;
  destroy(key: TDeploymentKey, config: TConfig): Promise<void>;
  wake?(
    key: TDeploymentKey,
    config: TConfig,
  ): Promise<TDeploymentInfo | null>;
}

export interface BrowserProvider<TSessionInput, TSession, TAction, TResult>
  extends InfrastructureProviderBase {
  area: "browsers";
  createSession(input: TSessionInput): Promise<TSession>;
  act(session: TSession, action: TAction): Promise<TResult>;
  closeSession(session: TSession): Promise<void>;
}

export interface InfrastructureProviderSelection {
  servers?: InfrastructureProviderId;
  deployments?: InfrastructureProviderId;
  browsers?: InfrastructureProviderId;
}

export interface InfrastructurePlugin {
  id: InfrastructureProviderId;
  providers: {
    servers?: ServerProvider<
      ServerContextBase,
      unknown,
      unknown,
      unknown,
      unknown
    >;
    deployments?: DeploymentProvider<unknown, unknown, unknown, unknown>;
    browsers?: BrowserProvider<unknown, unknown, unknown, unknown>;
  };
}
