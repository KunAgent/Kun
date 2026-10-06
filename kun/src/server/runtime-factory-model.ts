import {
  CompatModelClient,
  GeminiCliApiModelClient,
  GeminiCodeAssistModelClient,
  modelCapabilitiesForModel,
  modelCapabilitiesForProviderModel,
  safeProviderReasoningCapability,
  modelContextProfilesFromConfig,
  type ServeProviderConfig,
  type ModelClient,
  LlmDebugRecorder,
  DEFAULT_MODEL_ENDPOINT_FORMAT,
  type ModelEndpointFormat,
  LegacyProviderCredentialMigrationService,
  materializeLegacyProviderCredential,
  providerIdFromCredentialSource,
  type ModelConnectionSeed,
  type GeminiCodeAssistCredential
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import { subscriptionBillingKind } from '../shared/subscription-billing.js'
import { isRetiredOpenCodeFreeConnection } from '../services/model-connection-registry-usability.js'
import { exposableProvider } from '../domain/model-gateway-export-policy.js'
import { providerCredentialLease } from '../adapters/model/provider-credential-lease.js'

export async function hydrateLegacyCredentialOptions(
  options: KunServeRuntimeOptions,
  migration: LegacyProviderCredentialMigrationService
): Promise<KunServeRuntimeOptions> {
  let apiKey = options.apiKey
  let headers = options.headers
  let geminiAuth = options.geminiAuth
  if (options.credentialSourceId) {
    const resolved = await migration.resolveApiKey(options.credentialSourceId).catch(() => null)
    if (resolved) {
      const material = materializeLegacyProviderCredential(resolved.apiKey)
      apiKey = material.apiKey
      geminiAuth = material.geminiAuth ?? geminiAuth
      headers = material.headers
        ? { ...(headers ?? {}), ...material.headers }
        : headers
    }
  }

  const providers: Record<string, ServeProviderConfig> = {}
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    let nextProvider = provider
    if (provider.credentialSourceId) {
      const resolved = await migration.resolveApiKey(provider.credentialSourceId).catch(() => null)
      if (resolved) {
        const material = materializeLegacyProviderCredential(resolved.apiKey)
        nextProvider = {
          ...provider,
          apiKey: material.apiKey,
          ...(material.geminiAuth ? { geminiAuth: material.geminiAuth } : {}),
          ...(material.headers
            ? { headers: { ...(provider.headers ?? {}), ...material.headers } }
            : {})
        }
      }
    }
    providers[providerId] = nextProvider
  }
  return {
    ...options,
    apiKey,
    ...(geminiAuth ? { geminiAuth } : {}),
    ...(headers ? { headers } : {}),
    ...(options.providers ? { providers } : {})
  }
}

export function buildModelClientRouterInput(
  options: KunServeRuntimeOptions,
  modelCapabilities: (
    model: string,
    providerId?: string
  ) => ReturnType<typeof modelCapabilitiesForModel>,
  llmDebug?: LlmDebugRecorder,
  credentialResolver?: (
    sourceId: string,
    rejectedAccessToken?: string
  ) => Promise<{
    apiKey: string
    headers?: Record<string, string>
    geminiAuth?: GeminiCodeAssistCredential
    refreshable: boolean
  }>
): { default: ModelClient; providers: Map<string, ModelClient>; gatewayClients: Map<string, ModelClient>;
  defaultProviderId: string; admission: Map<string, { accountId: string; limits: import('../contracts/provider-configuration.js').ProviderAdmission }> } {
  const streamIdleOverride =
    options.runtime?.streamIdleTimeoutMs !== undefined
      ? { streamIdleTimeoutMs: options.runtime.streamIdleTimeoutMs }
      : {}
  const activeProviderId = activeModelConnectionProviderId(options)
  const activeProvider = options.providers?.[activeProviderId]
  const defaultModelProxyUrl = activeProvider &&
    Object.prototype.hasOwnProperty.call(activeProvider, 'modelProxyUrl')
    ? activeProvider.modelProxyUrl
    : options.modelProxyUrl
  const defaultModelCapabilities = providerScopedModelCapabilities(
    activeProviderId,
    activeProvider,
    modelCapabilities
  )
  const defaultBillingKind = subscriptionBillingKind({
    authType: activeProvider?.authType,
    presetSource: activeProvider?.presetSource,
    providerId: activeProviderId,
    baseUrl: activeProvider?.baseUrl ?? options.baseUrl
  })
  const defaultClient: ModelClient =
    options.modelConnectionSelectionRequired && !options.activeProviderId
      ? { provider: 'unavailable', model: options.model, async *stream() {
          yield { kind: 'error' as const, code: 'model_connection_unavailable',
            message: 'No active model connection. Enable and select a provider in settings.' }
        } }
      : process.env.KUN_RUNTIME_PROVIDER_KIND === 'gemini-code-assist'
      ? new GeminiCodeAssistModelClient({
          baseUrl: options.baseUrl,
          auth: options.geminiAuth,
          ...(options.credentialSourceId && credentialResolver
            ? {
                resolveAuth: async () =>
                  (await credentialResolver(options.credentialSourceId!)).geminiAuth ?? null
              }
            : {}),
          modelProxyUrl: defaultModelProxyUrl,
          model: options.model,
          modelCapabilities: defaultModelCapabilities
        })
      : process.env.KUN_RUNTIME_PROVIDER_KIND === 'gemini-cli-api'
      ? new GeminiCliApiModelClient({
          model: options.model,
          modelProxyUrl: defaultModelProxyUrl,
          retry: options.retry,
          ...(llmDebug ? { debugSink: llmDebug } : {})
        })
      : new CompatModelClient({
          providerId: activeProviderId,
          presetSource: activeProvider?.presetSource,
          baseUrl: options.baseUrl,
          apiKey: options.apiKey,
          modelProxyUrl: defaultModelProxyUrl,
          endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
          customEndpointProtocol: activeProvider?.customEndpointProtocol,
          inputTokenUpperBound: activeProvider?.admission?.inputTokenUpperBound,
          ...(activeProvider?.endpoints ? { endpoints: activeProvider.endpoints } : {}),
          retry: options.retry,
          model: options.model,
          modelCapabilities: defaultModelCapabilities,
          headers: options.headers,
          customHeaders: activeProvider?.customHeaders,
          authProfile: activeProvider?.authProfile, headerProfile: activeProvider?.headerProfile,
          ...(defaultBillingKind ? { billingKind: defaultBillingKind } : {}),
          ...(options.credentialSourceId && credentialResolver
            ? {
                resolveCredentials: providerCredentialLease((rejectedAccessToken?: string) =>
                  credentialResolver(options.credentialSourceId!, rejectedAccessToken), { apiKey: options.apiKey, headers: options.headers })
              }
            : {}),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...streamIdleOverride
        })
  const providerClients = new Map<string, ModelClient>()
  const gatewayClients = new Map<string, ModelClient>()
  const admission = new Map<string, { accountId: string; limits: import('../contracts/provider-configuration.js').ProviderAdmission }>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (!trimmedId) continue
    const kind = provider.kind ?? 'http'
    if (kind !== 'http' && kind !== 'gemini-cli-api' && kind !== 'gemini-code-assist') continue
    const scopedModelCapabilities = providerScopedModelCapabilities(
      trimmedId,
      provider,
      modelCapabilities
    )
    const providerBillingKind = subscriptionBillingKind({
      authType: provider.authType,
      presetSource: provider.presetSource,
      providerId: trimmedId,
      baseUrl: provider.baseUrl
    })
    const client: ModelClient = kind === 'gemini-code-assist'
      ? new GeminiCodeAssistModelClient({
          baseUrl: provider.baseUrl ?? options.baseUrl,
          auth: provider.geminiAuth,
          ...(provider.credentialSourceId && credentialResolver
            ? {
                resolveAuth: async () =>
                  (await credentialResolver(provider.credentialSourceId!)).geminiAuth ?? null
              }
            : {}),
          modelProxyUrl: Object.prototype.hasOwnProperty.call(provider, 'modelProxyUrl')
            ? provider.modelProxyUrl
            : options.modelProxyUrl,
          model: options.model,
          modelCapabilities: scopedModelCapabilities
        })
      : kind === 'gemini-cli-api'
      ? new GeminiCliApiModelClient({
          model: options.model,
          modelProxyUrl: Object.prototype.hasOwnProperty.call(provider, 'modelProxyUrl')
            ? provider.modelProxyUrl
            : options.modelProxyUrl,
          retry: provider.retry ?? options.retry,
          ...(llmDebug ? { debugSink: llmDebug } : {})
        })
      : new CompatModelClient({
          providerId: trimmedId,
          presetSource: provider.presetSource,
          baseUrl: provider.baseUrl ?? options.baseUrl ?? '',
          apiKey: provider.apiKey,
          modelProxyUrl: Object.prototype.hasOwnProperty.call(provider, 'modelProxyUrl')
            ? provider.modelProxyUrl
            : options.modelProxyUrl,
          endpointFormat: provider.endpointFormat ?? options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
          customEndpointProtocol: provider.customEndpointProtocol,
          inputTokenUpperBound: provider.admission?.inputTokenUpperBound,
          ...(provider.endpoints ? { endpoints: provider.endpoints } : {}),
          retry: provider.retry ?? options.retry,
          model: options.model,
          modelCapabilities: scopedModelCapabilities,
          headers: provider.headers,
          customHeaders: provider.customHeaders,
          authProfile: provider.authProfile, headerProfile: provider.headerProfile,
          ...(providerBillingKind ? { billingKind: providerBillingKind } : {}),
          ...(provider.credentialSourceId && credentialResolver
            ? {
                resolveCredentials: providerCredentialLease((rejectedAccessToken?: string) =>
                  credentialResolver(provider.credentialSourceId!, rejectedAccessToken), { apiKey: provider.apiKey, headers: provider.headers })
              }
            : {}),
          ...(llmDebug ? { debugSink: llmDebug } : {}),
          ...streamIdleOverride
        })
    providerClients.set(trimmedId, client)
    if (provider.admission) admission.set(trimmedId.toLowerCase(), {
      accountId: provider.accountId ?? trimmedId, limits: provider.admission
    })
    if (exposableProvider({ kind, authType: provider.authType ?? 'api-key',
      configured: provider.authType === 'none' || Boolean(provider.apiKey.trim() || provider.credentialSourceId),
      credentialStatus: provider.authType === 'none' ? 'not-required' : 'ready' })) gatewayClients.set(trimmedId, client)
  }
  return { default: defaultClient, providers: providerClients, gatewayClients, admission, defaultProviderId: activeProviderId.toLowerCase() }
}

export function modelContextProfilesByProvider(
  providers: KunServeRuntimeOptions['providers']
): Map<string, ReturnType<typeof modelContextProfilesFromConfig>> {
  const out = new Map<string, ReturnType<typeof modelContextProfilesFromConfig>>()
  for (const [providerId, provider] of Object.entries(providers ?? {})) {
    const normalized = providerId.trim().toLowerCase()
    if (!normalized) continue
    out.set(normalized, modelContextProfilesFromConfig({
      models: { profiles: provider.modelProfiles ?? {} }
    }))
  }
  return out
}

export function providerScopedModelCapabilities(
  providerId: string,
  provider: ServeProviderConfig | undefined,
  fallback: (
    model: string,
    providerId?: string
  ) => ReturnType<typeof modelCapabilitiesForModel>
): (model: string) => ReturnType<typeof modelCapabilitiesForModel> {
  return (model) => {
    const explicit = provider?.modelCapabilities?.[model] ??
      provider?.modelCapabilities?.[model.trim().toLowerCase()]
    const providerFallback = modelCapabilitiesForProviderModel({
      providerId,
      presetSource: provider?.presetSource ?? providerId,
      baseUrl: provider?.baseUrl,
      kind: provider?.kind,
      model
    })
    if (explicit) {
      const requestedReasoning = shouldUpgradeProviderReasoning(
        providerId,
        provider?.endpointFormat,
        model,
        explicit.reasoning,
        providerFallback.reasoning
      )
        ? providerFallback.reasoning
        : explicit.reasoning ?? providerFallback.reasoning
      const reasoning = safeProviderReasoningCapability({
        providerId,
        presetSource: provider?.presetSource ?? providerId,
        baseUrl: provider?.baseUrl,
        kind: provider?.kind,
        model
      }, requestedReasoning)
      return {
        ...explicit,
        id: model,
        ...((reasoning ?? explicit.reasoning) ? { reasoning: reasoning ?? explicit.reasoning } : {}),
        ...(explicit.serviceTiers ?? providerFallback.serviceTiers
          ? { serviceTiers: [...(explicit.serviceTiers ?? providerFallback.serviceTiers ?? [])] }
          : {})
      }
    }
    const base = fallback(model, providerId)
    return {
      ...base,
      ...(providerFallback.reasoning ? { reasoning: providerFallback.reasoning } : {}),
      ...(providerFallback.serviceTiers
        ? { serviceTiers: [...providerFallback.serviceTiers] }
        : {})
    }
  }
}

export function shouldUpgradeProviderReasoning(
  providerId: string,
  endpointFormat: ModelEndpointFormat | undefined,
  model: string,
  configured: ReturnType<typeof modelCapabilitiesForModel>['reasoning'],
  fallback: ReturnType<typeof modelCapabilitiesForModel>['reasoning']
): boolean {
  if (!configured || !fallback) return false
  const placeholder = configured.requestProtocol === 'none' &&
    fallback.requestProtocol !== 'none' &&
    configured.defaultEffort === 'auto' &&
    configured.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
  const chatResponsesMismatch =
    endpointFormat === 'chat_completions' &&
    configured.requestProtocol === 'openai-responses' &&
    fallback.requestProtocol === 'openai-chat-completions' &&
    (
      (providerId.toLowerCase().includes('kimi-code') && model.trim().toLowerCase() === 'k3') ||
      (providerId.toLowerCase().includes('opencode-go') &&
        model.trim().toLowerCase().endsWith('grok-4.5'))
    )
  return placeholder || chatResponsesMismatch
}

export function agentSdkProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'agent-sdk') out.add(trimmedId)
  }
  return out
}

export function antigravityProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'antigravity-cli') out.add(trimmedId)
  }
  return out
}

export function cursorSdkProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  const out = new Set<string>()
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    const trimmedId = providerId.trim()
    if (trimmedId && (provider.kind ?? 'http') === 'cursor-sdk') out.add(trimmedId)
  }
  return out
}

/**
 * Provider-kind view used to infer a harness for legacy threads/turns and to
 * freeze `harnessId` at admission. `defaultKind` follows the env-level runtime
 * provider kind (KUN_RUNTIME_PROVIDER_KIND), not a provider id.
 */
export function providerKindsForOptions(
  options: KunServeRuntimeOptions,
  defaults: { defaultIsAgentSdk: boolean; defaultIsCursorSdk: boolean; defaultIsAntigravity: boolean }
): {
  byId: Record<string, ServeProviderConfig['kind'] | undefined>
  defaultKind: NonNullable<ServeProviderConfig['kind']>
} {
  const byId: Record<string, ServeProviderConfig['kind'] | undefined> = {}
  for (const [providerId, provider] of Object.entries(options.providers ?? {})) {
    byId[providerId] = provider.kind ?? 'http'
  }
  const defaultKind: NonNullable<ServeProviderConfig['kind']> = defaults.defaultIsAgentSdk
    ? 'agent-sdk'
    : defaults.defaultIsCursorSdk
      ? 'cursor-sdk'
      : defaults.defaultIsAntigravity
        ? 'antigravity-cli'
        : 'http'
  return { byId, defaultKind }
}

/** Provider engines that cannot enforce Kun room tools, approvals, or scoped writes. */
export function roomUnsupportedProviderIdsForOptions(options: KunServeRuntimeOptions): Set<string> {
  // Cursor's custom tools do not replace its native filesystem/shell catalog.
  // Until the SDK exposes a deny gate for those calls, a bridge is not sufficient.
  return new Set([...antigravityProviderIdsForOptions(options), ...cursorSdkProviderIdsForOptions(options)])
}

export function approvalReviewNativeProviderKind(
  value: string | undefined
): 'agent-sdk' | 'cursor-sdk' | 'antigravity-cli' | undefined {
  return value === 'agent-sdk' || value === 'cursor-sdk' || value === 'antigravity-cli'
    ? value
    : undefined
}

export function activeModelConnectionProviderId(
  options: Pick<KunServeRuntimeOptions, 'activeProviderId' | 'credentialSourceId' | 'providers'>
): string {
  const explicit = options.activeProviderId?.trim() ?? ''
  if (explicit && options.providers?.[explicit]) return explicit
  const prefix = 'settings:provider:'
  const source = options.credentialSourceId?.trim() ?? ''
  const candidate = source.startsWith(prefix)
    ? source.slice(prefix.length).trim()
    : providerIdFromCredentialSource(source)?.trim() ?? ''
  return candidate && options.providers?.[candidate] ? candidate : 'default'
}

/**
 * Secret-free model choices exposed to extension-owned Agent runs. The list is
 * deliberately scoped to the active Kun connection: selecting a model never
 * grants an extension access to another provider or account.
 */
export function extensionAgentRunOptionsForOptions(options: KunServeRuntimeOptions) {
  const providerId = activeModelConnectionProviderId(options)
  const provider = providerId === 'default' ? undefined : options.providers?.[providerId]
  const models = uniqueModelCatalog([
    ...(provider?.models ?? []),
    provider?.selectedModel,
    options.model
  ])
  return {
    defaultModel: options.model,
    models: models.map((model) => {
      const capabilities = provider?.modelCapabilities?.[model] ?? modelCapabilitiesForProviderModel({
        providerId,
        presetSource: provider?.presetSource,
        baseUrl: provider?.baseUrl ?? options.baseUrl,
        kind: provider?.kind,
        model
      })
      const reasoning = capabilities.reasoning
      return {
        id: model,
        displayName: model,
        selected: model === options.model,
        reasoningEfforts: reasoning ? [...reasoning.supportedEfforts] : [],
        ...(reasoning ? { defaultReasoningEffort: reasoning.defaultEffort } : {})
      }
    })
  }
}

export function modelConnectionSeedsForOptions(
  options: KunServeRuntimeOptions
): ModelConnectionSeed[] {
  const activeConnectionId = activeModelConnectionProviderId(options)
  const activeProvider = options.providers?.[activeConnectionId]
  const activeKind = activeProvider?.kind ?? 'http'
  const activeModels = uniqueModelCatalog([
    ...(activeProvider?.models ?? []),
    activeProvider?.selectedModel,
    options.model
  ])
  return [
    {
      expectedRevision: 0,
      id: activeConnectionId,
      name: activeConnectionId === 'default' ? 'Default provider' : activeConnectionId,
      ...(activeProvider?.presetSource
        ? {
            presetSource: activeProvider.presetSource,
            ...(activeProvider.presetMode ? { presetMode: activeProvider.presetMode } : {})
          }
        : activeConnectionId === 'default' ? {} : { presetSource: activeConnectionId }),
      kind: activeKind,
      authType: activeProvider?.authType ?? modelConnectionAuthType(activeKind, options.apiKey),
      ...(activeKind === 'http'
        ? { baseUrl: options.baseUrl || 'https://api.deepseek.com' }
        : activeKind === 'gemini-code-assist' && options.baseUrl
          ? { baseUrl: options.baseUrl }
          : {}),
      endpointFormat: options.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
      ...(activeProvider?.endpoints ? { endpoints: activeProvider.endpoints } : {}),
      ...(activeProvider?.useProxy === undefined ? {} : { useProxy: activeProvider.useProxy }),
      ...(options.credentialSourceId
        ? { credentialSourceId: options.credentialSourceId }
        : {}),
      credential: modelConnectionSeedCredential(
        activeKind,
        options.apiKey,
        activeProvider?.geminiAuth ?? options.geminiAuth
      ),
      models: activeModels,
      ...(activeProvider?.modelCapabilities
        ? { modelCapabilities: activeProvider.modelCapabilities }
        : {}),
      selectedModel: options.model,
      probe: false,
      select: true
    },
    ...Object.entries(options.providers ?? {})
      .filter(([providerId]) => providerId !== activeConnectionId)
      .map(([providerId, provider]): ModelConnectionSeed => ({
        expectedRevision: 0,
        id: providerId,
        name: providerId,
        ...(provider.presetSource
          ? {
              presetSource: provider.presetSource,
              ...(provider.presetMode ? { presetMode: provider.presetMode } : {})
            }
          : {}),
        kind: provider.kind ?? 'http',
        authType: provider.authType ?? modelConnectionAuthType(provider.kind ?? 'http', provider.apiKey),
        ...(provider.useProxy === undefined ? {} : { useProxy: provider.useProxy }),
        ...((provider.kind ?? 'http') === 'http'
          ? { baseUrl: provider.baseUrl || options.baseUrl || 'https://api.deepseek.com' }
          : (provider.kind ?? 'http') === 'gemini-code-assist' && provider.baseUrl
            ? { baseUrl: provider.baseUrl }
            : {}),
        endpointFormat: provider.endpointFormat ?? DEFAULT_MODEL_ENDPOINT_FORMAT,
        ...(provider.endpoints ? { endpoints: provider.endpoints } : {}),
        ...(provider.credentialSourceId
          ? { credentialSourceId: provider.credentialSourceId }
          : {}),
        credential: modelConnectionSeedCredential(provider.kind ?? 'http', provider.apiKey, provider.geminiAuth),
        models: uniqueModelCatalog([
          ...(provider.models ?? []),
          provider.selectedModel
        ]),
        ...(provider.modelCapabilities ? { modelCapabilities: provider.modelCapabilities } : {}),
        ...(provider.selectedModel ? { selectedModel: provider.selectedModel } : {}),
        probe: false,
        select: false
      }))
  ].filter((seed) => !isRetiredOpenCodeFreeConnection({
    id: seed.id,
    presetSource: seed.presetSource
  }))
}

export function uniqueModelCatalog(models: readonly (string | undefined)[]): string[] {
  return [...new Set(models.map((model) => model?.trim()).filter((model): model is string => Boolean(model)))]
}

export function modelConnectionSeedCredential(
  kind:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist',
  apiKey: string,
  geminiAuth?: GeminiCodeAssistCredential
): string {
  return kind === 'gemini-code-assist' && geminiAuth
    ? JSON.stringify(geminiAuth)
    : apiKey
}

export function modelConnectionAuthType(
  kind:
    | 'http'
    | 'agent-sdk'
    | 'antigravity-cli'
    | 'cursor-sdk'
    | 'gemini-cli-api'
    | 'gemini-code-assist',
  credential: string
): 'api-key' | 'oauth' | 'subscription' {
  if (
    kind === 'agent-sdk' ||
    kind === 'antigravity-cli' ||
    kind === 'cursor-sdk' ||
    kind === 'gemini-cli-api' ||
    kind === 'gemini-code-assist'
  ) return 'subscription'
  try {
    const parsed = JSON.parse(credential) as { kind?: unknown }
    if (parsed.kind === 'codex-oauth' || parsed.kind === 'grok-oauth') return 'oauth'
  } catch {
    // Plain API keys are intentionally not JSON.
  }
  return 'api-key'
}
