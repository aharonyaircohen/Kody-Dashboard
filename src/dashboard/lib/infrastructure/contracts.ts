/**
 * @fileType library
 * @domain infrastructure
 * @pattern provider-contracts
 * @ai-summary Brand-agnostic infrastructure contracts. Kody owns these
 *   concepts; Fly/OpenComputer/Coolify are adapters behind them.
 */

export type InfrastructureProviderId = "fly";

export type InfrastructureArea = "compute" | "deployments" | "browsers";

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

export interface ComputeProvider<
  TContext,
  TRunInput,
  TRunResult,
  TClaimInput = never,
  TClaimResult = never,
> extends InfrastructureProviderBase {
  area: "compute";
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
