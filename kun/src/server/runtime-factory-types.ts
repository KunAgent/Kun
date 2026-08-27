import type {
  ApprovalPolicy,
  ApprovalReviewer,
  ContextCompactionConfig,
  FastContextConfig,
  FaultInjectionController,
  GeminiCodeAssistCredential,
  GraphRuntimeConfig,
  HooksConfig,
  KunCapabilitiesConfig,
  LabConfig,
  LocalModelGatewayConfig,
  ModelConfig,
  ModelEndpointFormat,
  ModelRequestRetryConfig,
  ModelRoutePoolConfig,
  NodeHttpServerHandle,
  ObservabilityConfig,
  QualityConfig,
  RolesConfig,
  RuntimeFlavor,
  RuntimeTuningConfig,
  SandboxMode,
  ServerRuntime,
  ServiceManagerConnection,
  ServeProviderConfig,
  StorageConfig,
  TokenEconomyConfig,
  ToolOutputLimitsConfig
} from './runtime-factory-dependencies.js'

export type KunServeRuntimeOptions = {
  host: string
  port: number
  configPath?: string
  dataDir: string
  sharedMcpConfigPath?: string
  bundledExtensionsDir?: string
  runtimeToken: string
  apiKey: string
  credentialSourceId?: string
  geminiAuth?: GeminiCodeAssistCredential
  baseUrl: string
  modelProxyUrl?: string
  endpointFormat?: ModelEndpointFormat
  retry?: ModelRequestRetryConfig
  headers?: Record<string, string>
  providers?: Record<string, ServeProviderConfig>
  routePools?: ModelRoutePoolConfig[]
  localModelGateway?: LocalModelGatewayConfig
  model: string
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  approvalReviewer?: ApprovalReviewer
  tokenEconomyMode: boolean
  tokenEconomy?: TokenEconomyConfig
  toolOutputLimits?: ToolOutputLimitsConfig
  insecure: boolean
  models?: ModelConfig
  contextCompaction?: ContextCompactionConfig
  runtime?: RuntimeTuningConfig
  roles?: RolesConfig
  storage?: StorageConfig
  observability?: ObservabilityConfig
  graph?: GraphRuntimeConfig
  capabilities?: KunCapabilitiesConfig
  hooks?: HooksConfig
  quality?: QualityConfig
  fastContext?: FastContextConfig
  lab?: LabConfig
  startedAt?: string
  instanceId?: string
  buildId?: string
  launchMode?: 'foreground' | 'shared' | 'gui'
  runtimeFlavor?: RuntimeFlavor
  discoveryDir?: string
  serviceManager?: ServiceManagerConnection
  logPath?: string
  faultInjection?: FaultInjectionController
  extensionHostRunnerPath?: string
}

export type KunServeHandle = NodeHttpServerHandle & {
  runtime: ServerRuntime
  instanceId: string
  shutdownRequested: Promise<void>
}
