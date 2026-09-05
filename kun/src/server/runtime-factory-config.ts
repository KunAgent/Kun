import {
  join,
  type KunCapabilitiesConfig,
  type TokenEconomyConfig,
  DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG,
  type ToolOutputLimitsConfig,
  type RuntimeConfigApplyRequest,
  AtomicJsonFile
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'

export function mergeRuntimeConfigApplyOptions(
  current: KunServeRuntimeOptions,
  request: RuntimeConfigApplyRequest
): KunServeRuntimeOptions {
  const serve = request.serve ?? {}
  return {
    ...current,
    apiKey: serve.apiKey ?? current.apiKey,
    credentialSourceId: serve.credentialSourceId ?? current.credentialSourceId,
    baseUrl: serve.baseUrl ?? current.baseUrl,
    modelProxyUrl: serve.modelProxyUrl ?? current.modelProxyUrl,
    endpointFormat: serve.endpointFormat ?? current.endpointFormat,
    retry: serve.retry ?? current.retry,
    headers: serve.headers ?? current.headers,
    providers: mergeRuntimeProviderCredentials(current.providers, serve.providers),
    routePools: serve.routePools ?? current.routePools,
    localModelGateway: serve.localModelGateway ?? current.localModelGateway,
    model: serve.model ?? current.model,
    approvalPolicy: serve.approvalPolicy ?? current.approvalPolicy,
    sandboxMode: serve.sandboxMode ?? current.sandboxMode,
    approvalReviewer: serve.approvalReviewer ?? current.approvalReviewer,
    tokenEconomyMode: serve.tokenEconomyMode ?? current.tokenEconomyMode,
    tokenEconomy: serve.tokenEconomy ?? current.tokenEconomy,
    toolOutputLimits: serve.toolOutputLimits ?? current.toolOutputLimits,
    models: request.models ?? current.models,
    contextCompaction: request.contextCompaction ?? current.contextCompaction,
    runtime: request.runtime ?? current.runtime,
    graph: request.graph ?? current.graph,
    roles: request.roles ?? current.roles,
    fastContext: request.fastContext ?? current.fastContext,
    capabilities: request.capabilities ?? current.capabilities,
    hooks: request.hooks ?? current.hooks,
    quality: request.quality ?? current.quality,
    lab: request.lab ?? current.lab
  }
}

function mergeRuntimeProviderCredentials(
  current: KunServeRuntimeOptions['providers'],
  next: KunServeRuntimeOptions['providers']
): KunServeRuntimeOptions['providers'] {
  if (!next) return current
  return Object.fromEntries(Object.entries(next).map(([providerId, provider]) => {
    const currentCredentialSourceId = current?.[providerId]?.credentialSourceId
    return [providerId, {
      ...provider,
      ...(provider.credentialSourceId || !currentCredentialSourceId
        ? {}
        : { credentialSourceId: currentCredentialSourceId })
    }]
  }))
}

export function llmDebugCaptureEnabled(
  options: Pick<KunServeRuntimeOptions, 'runtime'>
): boolean {
  return options.runtime?.llmDebug?.enabled !== false
}

export function modelRequestCaptureDefaultEnabled(
  options: Pick<KunServeRuntimeOptions, 'runtime'>
): boolean {
  return options.runtime?.llmDebug?.defaultThreadCaptureEnabled === true
}

export async function persistRuntimeMcpConfig(
  dataDir: string,
  mcp: KunCapabilitiesConfig['mcp']
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: {
      ...objectSection(current.capabilities),
      mcp
    }
  }))
}

export async function persistRuntimeSkillsConfig(
  dataDir: string,
  skills: KunCapabilitiesConfig['skills']
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: { ...objectSection(current.capabilities), skills }
  }))
}

export async function persistRuntimeCapabilitySection(
  dataDir: string,
  id: 'attachments' | 'memory',
  value: KunCapabilitiesConfig[typeof id]
): Promise<void> {
  const target = join(dataDir, 'config.json')
  await updateRuntimeJson(target, (current) => ({
    ...current,
    capabilities: { ...objectSection(current.capabilities), [id]: value }
  }))
}

export async function persistSharedMcpConfig(
  target: string,
  mcp: KunCapabilitiesConfig['mcp']
): Promise<void> {
  const userManagedServers = Object.fromEntries(
    Object.entries(mcp.servers).filter(([, server]) => !server.managedBy)
  )
  await updateRuntimeJson(target, (current) => ({
    ...current,
    // Shared mcp.json is user-owned input. System-managed descriptors belong
    // only in runtime config; copying them here would turn them into user
    // overrides on the next GUI synchronization and strip host ownership.
    servers: structuredClone(userManagedServers)
  }))
}

export async function updateRuntimeJson(
  path: string,
  mutate: (current: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const file = new AtomicJsonFile(path, (value) => objectSection(value))
  await file.update(() => ({}), mutate)
}

export function objectSection(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function tokenEconomyConfigForOptions(
  options: Pick<KunServeRuntimeOptions, 'tokenEconomyMode' | 'tokenEconomy'>
): TokenEconomyConfig {
  return {
    ...(options.tokenEconomy ?? {}),
    enabled: options.tokenEconomy?.enabled ?? options.tokenEconomyMode
  }
}

export function toolOutputLimitsForOptions(
  options: Pick<KunServeRuntimeOptions, 'toolOutputLimits'>
): Required<ToolOutputLimitsConfig> {
  return {
    maxLines: Math.max(
      1,
      Math.floor(options.toolOutputLimits?.maxLines ?? DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG.maxLines)
    ),
    maxBytes: Math.max(
      1,
      Math.floor(options.toolOutputLimits?.maxBytes ?? DEFAULT_TOOL_OUTPUT_LIMITS_CONFIG.maxBytes)
    )
  }
}

export function builtinToolOptionsForOptions(options: KunServeRuntimeOptions) {
  const outputLimits = toolOutputLimitsForOptions(options)
  return {
    read: outputLimits,
    bash: outputLimits
  }
}

/**
 * PPT Master was a host-managed Skill. Keep an old package on disk inert after
 * the first-class PPT agent replaced it, without deleting user data.
 */
export function skillsConfigForRuntime(
  options: Pick<KunServeRuntimeOptions, 'capabilities'>
): NonNullable<KunServeRuntimeOptions['capabilities']>['skills'] | undefined {
  const skills = options.capabilities?.skills
  if (!skills) return undefined
  return {
    ...skills,
    disabledIds: [...new Set([...skills.disabledIds, 'ppt-master'])]
  }
}
