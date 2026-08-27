import {
  mkdir,
  join,
  ExtensionModelProviderRegistry,
  MultiProviderModelClient,
  RoutePoolHealthStore,
  RoutePoolModelClient,
  withModelTiming,
  ApprovalReviewService,
  buildApprovalReviewModelRouterInput,
  ProviderQuotaService,
  resolveDefaultCodexQuotaCredential,
  resolveDefaultGrokQuotaCredential,
  resolveOpenCodeGoCookie,
  fetchOpenCodeGoWebQuota,
  RoutePoolTestService,
  SubagentRouter,
  createSecretEncryptor,
  defaultSecretCommandRunner,
  hasPersistedSecretKeyMaterial,
  ExtensionLogWriter,
  ExtensionCredentialStore,
  ExtensionProviderAccountStore,
  ExtensionAccountBroker,
  LegacyProviderCredentialMigrationService,
  materializeLegacyProviderCredential,
  CodexOAuthCredentialRefresher,
  GrokOAuthCredentialRefresher,
  isModelConnectionCredentialSourceId,
  ModelConnectionRegistry,
  ModelConnectionOAuthService,
  ClaudeConnectionService,
  OfficialProviderAuthService,
  type GeminiCodeAssistCredential
} from './runtime-factory-dependencies.js'
import type { KunServeRuntimeOptions } from './runtime-factory-types.js'
import type { createRuntimeCore } from './runtime-composition-core.js'
import {
  agentSdkProviderIdsForOptions,
  antigravityProviderIdsForOptions,
  approvalReviewNativeProviderKind,
  buildModelClientRouterInput,
  cursorSdkProviderIdsForOptions,
  hydrateLegacyCredentialOptions,
  modelConnectionSeedsForOptions
} from './runtime-factory-model.js'
import { aggregateCodexProviderLocalCosts } from '../services/provider-local-cost.js'
import { loadUsageHistory } from '../services/usage-history.js'

export async function createRuntimeModelComposition(
  core: Awaited<ReturnType<typeof createRuntimeCore>>
) {
  const {
    usageService,
    nowIso,
    llmDebug,
    events,
    modelCapabilities,
    registryModelCapabilities
  } = core
  const agentSdkProviderIds = agentSdkProviderIdsForOptions(core.activeOptions)
  const antigravityProviderIds = antigravityProviderIdsForOptions(core.activeOptions)
  const cursorSdkProviderIds = cursorSdkProviderIdsForOptions(core.activeOptions)
  const refreshDelegatedProviderIds = (): void => {
    agentSdkProviderIds.clear()
    for (const providerId of agentSdkProviderIdsForOptions(core.activeOptions)) {
      agentSdkProviderIds.add(providerId)
    }
    antigravityProviderIds.clear()
    for (const providerId of antigravityProviderIdsForOptions(core.activeOptions)) {
      antigravityProviderIds.add(providerId)
    }
    cursorSdkProviderIds.clear()
    for (const providerId of cursorSdkProviderIdsForOptions(core.activeOptions)) {
      cursorSdkProviderIds.add(providerId)
    }
  }
  let refreshModelConnectionDelegatedDeps = (): void => undefined
  const extensionProviderAccounts = new ExtensionProviderAccountStore({
    dataDir: core.activeOptions.dataDir,
    nowIso
  })
  const extensionCredentialKeyProvider = await createSecretEncryptor({
    keyFilePath: join(core.activeOptions.dataDir, 'secret.key'),
    run: defaultSecretCommandRunner,
    canBootstrapKeyFileFallback: async () => !(await hasPersistedSecretKeyMaterial(core.activeOptions.dataDir))
  })
  const extensionCredentials = new ExtensionCredentialStore({
    dataDir: core.activeOptions.dataDir,
    profileId: 'default',
    keyProvider: extensionCredentialKeyProvider,
    nowIso
  })
  const extensionAccountAudit = new ExtensionLogWriter(
    join(core.activeOptions.dataDir, 'extensions', 'account-audit.log'),
    { maxBytes: 5 * 1024 * 1024, retention: 3 }
  )
  const extensionAccounts = new ExtensionAccountBroker({
    store: extensionProviderAccounts,
    credentials: extensionCredentials,
    audit: (event) => extensionAccountAudit.write('lifecycle', JSON.stringify(event))
  })
  const extensionModelProviders = new ExtensionModelProviderRegistry({
    accounts: extensionProviderAccounts
  })
  const legacyCredentialMigration = new LegacyProviderCredentialMigrationService({
    dataDir: core.activeOptions.dataDir,
    accounts: extensionProviderAccounts,
    credentials: extensionCredentials,
    nowIso
  })
  let modelConnections!: ModelConnectionRegistry
  const safeCredentialUnavailableMessage = 'protected model credential is unavailable'
  const requestCredentialStore = {
    resolveApiKey: async (sourceId: string) => {
      try {
        return isModelConnectionCredentialSourceId(sourceId)
          ? await modelConnections.resolveApiKey(sourceId)
          : await legacyCredentialMigration.resolveApiKey(sourceId)
      } catch {
        // Request errors may cross HTTP/SSE boundaries. Never expose protected
        // source identifiers or keychain/decryption details to those clients.
        throw new Error(safeCredentialUnavailableMessage)
      }
    },
    updateResolvedApiKey: async (sourceId: string, expectedApiKey: string, apiKey: string) => {
      try {
        return isModelConnectionCredentialSourceId(sourceId)
          ? await modelConnections.updateResolvedApiKey(sourceId, expectedApiKey, apiKey)
          : await legacyCredentialMigration.updateResolvedApiKey(sourceId, expectedApiKey, apiKey)
      } catch {
        throw new Error(safeCredentialUnavailableMessage)
      }
    }
  }
  const grokCredentialRefresher = new GrokOAuthCredentialRefresher(
    requestCredentialStore
  )
  const codexCredentialRefresher = new CodexOAuthCredentialRefresher(
    requestCredentialStore
  )
  const resolveLegacyRequestCredentials = async (
    sourceId: string,
    rejectedAccessToken?: string
  ): Promise<{
    apiKey: string
    headers?: Record<string, string>
    geminiAuth?: GeminiCodeAssistCredential
    refreshable: boolean
  }> => {
    try {
      let resolved = await codexCredentialRefresher.resolve(sourceId, rejectedAccessToken)
      if (!resolved.refreshable) {
        resolved = await grokCredentialRefresher.resolve(sourceId, rejectedAccessToken)
      }
      const material = materializeLegacyProviderCredential(resolved.rawApiKey)
      return {
        ...material,
        refreshable: resolved.refreshable
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (
        message === safeCredentialUnavailableMessage ||
        message.startsWith('protected credential source is unavailable')
      ) {
        throw new Error(safeCredentialUnavailableMessage)
      }
      throw error
    }
  }
  const migrateLegacyProviderCredentials = async (
    options: KunServeRuntimeOptions = core.activeOptions
  ): Promise<void> => {
    const sources = [
      ...(options.apiKey.trim() && !options.credentialSourceId ? [{
        sourceId: 'runtime:default',
        providerId: 'default',
        providerName: 'Kun default provider',
        label: 'Migrated runtime credential',
        apiKey: options.apiKey
      }] : []),
      ...Object.entries(options.providers ?? {})
        .filter(([, provider]) => provider.apiKey.trim() && !provider.credentialSourceId)
        .map(([providerId, provider]) => ({
          sourceId: `runtime:provider:${providerId}`,
          providerId,
          providerName: providerId,
          label: 'Migrated provider credential',
          apiKey: provider.apiKey
        }))
    ]
    try {
      await legacyCredentialMigration.migrate(sources)
    } catch {
      // Compatibility reads remain authoritative until a secure migration
      // commits; a credential-backend outage must not break the live runtime.
    }
  }
  await migrateLegacyProviderCredentials()
  core.activeOptions = await hydrateLegacyCredentialOptions(core.activeOptions, legacyCredentialMigration)
  await mkdir(join(core.activeOptions.dataDir, 'approval-review'), {
    recursive: true,
    mode: 0o700
  })
  const buildApprovalReviewClients = (
    options: KunServeRuntimeOptions,
    direct: ReturnType<typeof buildModelClientRouterInput>
  ) => buildApprovalReviewModelRouterInput({
    direct,
    providers: options.providers,
    defaultProviderKind: approvalReviewNativeProviderKind(
      process.env.KUN_RUNTIME_PROVIDER_KIND
    ),
    defaultApiKey: options.apiKey,
    defaultModel: options.model,
    reviewCwd: join(options.dataDir, 'approval-review'),
    ...(process.env.KUN_CLAUDE_BINARY
      ? { pathToClaudeCodeExecutable: process.env.KUN_CLAUDE_BINARY }
      : {})
  })
  const initialModelClients = buildModelClientRouterInput(
    core.activeOptions,
    modelCapabilities,
    llmDebug,
    resolveLegacyRequestCredentials
  )
  const directModelClient = new MultiProviderModelClient(initialModelClients)
  const approvalReviewModelClient = new MultiProviderModelClient(
    buildApprovalReviewClients(core.activeOptions, initialModelClients)
  )
  const approvalReviewService = new ApprovalReviewService({
    // Automatic review must not route through a model pool because pool
    // failover would silently substitute the acting turn's selected route.
    model: approvalReviewModelClient,
    events,
    usage: usageService,
    nowIso
  })
  const routeHealth = new RoutePoolHealthStore(join(core.activeOptions.dataDir, 'model-routing', 'health.json'))
  await routeHealth.load()
  const modelClient = new RoutePoolModelClient(
    directModelClient,
    core.activeOptions.routePools ?? [],
    modelCapabilities,
    routeHealth
  )
  /**
   * Timing-instrumented entry point shared by the chat loop, child agents,
   * review, and compaction so every model response reports TTFT and
   * generation duration on its usage chunk.
   */
  const timedModelClient = withModelTiming(modelClient)
  const routePoolTests = new RoutePoolTestService(
    modelClient,
    () => modelClient.routePools(),
    routeHealth
  )
  const subagentRouter = new SubagentRouter({
    modelClient: timedModelClient,
    roles: () => core.activeOptions.roles,
    defaultModel: () => core.activeOptions.model,
    recordUsage: async ({ threadId, turnId, model, providerId, usage }) => {
      const cumulative = usageService.record(threadId, usage, undefined, turnId)
      await events.record({
        kind: 'usage',
        threadId,
        turnId,
        model,
        ...(providerId ? { providerId } : {}),
        usage: cumulative
      })
    }
  })
  const replaceRoutedModelClients = (): void => {
    const next = buildModelClientRouterInput(
      core.activeOptions,
      modelCapabilities,
      llmDebug,
      resolveLegacyRequestCredentials
    )
    for (const [providerId, client] of extensionModelProviders.clientMap()) {
      next.providers.set(providerId, client)
    }
    directModelClient.replace(next)
    approvalReviewModelClient.replace(buildApprovalReviewClients(core.activeOptions, next))
    modelClient.replacePools(core.activeOptions.routePools ?? [])
  }
  modelConnections = new ModelConnectionRegistry({
    dataDir: core.activeOptions.dataDir,
    credentials: extensionCredentials,
    modelCapabilities: registryModelCapabilities,
    retireLegacyCredentialSource: async (sourceId) => {
      await legacyCredentialMigration.forgetSources([sourceId])
    },
    inspectCredentialSource: async (sourceId) => {
      try {
        const resolved = await requestCredentialStore.resolveApiKey(sourceId)
        return resolved?.apiKey?.trim() ? 'ready' : 'missing'
      } catch {
        return 'unreadable'
      }
    },
    resolveCredentialSource: resolveLegacyRequestCredentials,
    onChanged: (connections) => {
      const selected = connections.selected
      const providers = Object.fromEntries(connections.providers.entries())
      const nextOptions: KunServeRuntimeOptions = {
        ...core.activeOptions,
        ...(selected
          ? {
              model: selected.model,
              apiKey: selected.config.apiKey,
              credentialSourceId: selected.config.credentialSourceId,
              baseUrl: selected.config.baseUrl ?? core.activeOptions.baseUrl,
              endpointFormat: selected.config.endpointFormat ?? core.activeOptions.endpointFormat,
              headers: selected.config.headers,
              geminiAuth: selected.config.geminiAuth
            }
          : {
              // Disconnecting the last provider must also retire its decrypted
              // credential from the live router. Keep only a harmless model
              // identifier for diagnostics until a new default is selected.
              apiKey: '',
              headers: undefined,
              geminiAuth: undefined
            }),
        providers,
        modelProxyUrl: connections.proxy.enabled ? connections.proxy.url : undefined,
        routePools: connections.routePools,
        localModelGateway: connections.localModelGateway
      }
      const nextClients = buildModelClientRouterInput(
        nextOptions,
        modelCapabilities,
        llmDebug,
        resolveLegacyRequestCredentials
      )
      for (const [providerId, client] of extensionModelProviders.clientMap()) {
        nextClients.providers.set(providerId, client)
      }
      core.activeOptions = nextOptions
      refreshDelegatedProviderIds()
      directModelClient.replace(nextClients)
      approvalReviewModelClient.replace(buildApprovalReviewClients(core.activeOptions, nextClients))
      modelClient.replacePools(core.activeOptions.routePools ?? [])
      refreshModelConnectionDelegatedDeps()
    }
  })
  await modelConnections.initialize(modelConnectionSeedsForOptions(core.activeOptions), {
    proxy: { enabled: Boolean(core.activeOptions.modelProxyUrl), url: core.activeOptions.modelProxyUrl ?? '' },
    routePools: core.activeOptions.routePools ?? [],
    localModelGateway: core.activeOptions.localModelGateway ?? { enabled: false }
  })
  const resolveCapabilityProviderCredential = async (providerId: string): Promise<{
    apiKey: string
    headers?: Record<string, string>
    proxyUrl?: string
  }> => {
    const materialized = await modelConnections.materialize()
    const provider = materialized.providers.get(providerId)
    if (!provider || provider.kind !== 'http') {
      throw new Error(`Model connection ${providerId} is unavailable for media generation`)
    }
    let apiKey = provider.apiKey.trim()
    let headers = provider.headers
    if (provider.credentialSourceId) {
      const resolved = await resolveLegacyRequestCredentials(provider.credentialSourceId)
      apiKey = resolved.apiKey.trim()
      headers = { ...(headers ?? {}), ...(resolved.headers ?? {}) }
    }
    if (!apiKey) {
      throw new Error(`Model connection ${providerId} has no usable credential`)
    }
    // Media tools share the provider-level global proxy with chat model
    // requests so a proxy-restricted provider stays reachable end to end.
    const proxyUrl = materialized.proxy.enabled ? materialized.proxy.url.trim() : ''
    return {
      apiKey,
      ...(headers ? { headers } : {}),
      ...(proxyUrl ? { proxyUrl } : {})
    }
  }
  const providerUsageHistorySource = {
    threadService: core.threadService,
    sessionStore: core.sessionStore,
    usageService,
    nowIso
  }
  const providerQuotaService = new ProviderQuotaService({
    loadSource: async () => {
      const [snapshot, materialized] = await Promise.all([
        modelConnections.snapshot(),
        modelConnections.materialize()
      ])
      const profiles = await Promise.all(snapshot.providers.map(async (profile) => {
        const config = materialized.providers.get(profile.id)
        let apiKey = config?.apiKey ?? ''
        let headers = (config?.kind ?? 'http') === 'http'
          ? config?.headers
          : undefined
        if (config?.credentialSourceId) {
          try {
            const resolved = await resolveLegacyRequestCredentials(config.credentialSourceId)
            apiKey = resolved.apiKey
            headers = { ...(headers ?? {}), ...(resolved.headers ?? {}) }
          } catch {
            // A missing protected binding becomes a per-provider missing-credential state.
          }
        }
        return {
          id: profile.id,
          name: profile.name,
          ...(profile.presetSource ? { presetId: profile.presetSource } : {}),
          kind: profile.kind,
          ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
          apiKey,
          ...(headers ? { headers } : {}),
          ...(config?.credentialSourceId
            ? { credentialSourceId: config.credentialSourceId }
            : {})
        }
      }))
      return {
        profiles,
        proxyUrl: snapshot.proxy.enabled ? snapshot.proxy.url : ''
      }
    },
    loadLocalCosts: async (profiles) => aggregateCodexProviderLocalCosts({
      profiles: profiles.map((profile) => ({
        id: profile.id,
        ...(profile.presetId ? { presetId: profile.presetId } : {})
      })),
      records: await loadUsageHistory(providerUsageHistorySource),
      now: new Date(nowIso())
    }),
    subscriptionRuntime: {
      resolveCodexCredential: async (provider, rejectedAccessToken) => {
        if (!provider.credentialSourceId) {
          return resolveDefaultCodexQuotaCredential(provider, rejectedAccessToken)
        }
        try {
          const resolved = await resolveLegacyRequestCredentials(
            provider.credentialSourceId,
            rejectedAccessToken
          )
          const accessToken = resolved.apiKey.trim()
          if (!accessToken) return undefined
          const accountId = new Headers(resolved.headers).get('chatgpt-account-id')?.trim()
          return {
            accessToken,
            ...(accountId ? { accountId } : {})
          }
        } catch {
          return undefined
        }
      },
      resolveGrokCredential: async (provider, rejectedAccessToken) => {
        if (!provider.credentialSourceId) {
          return resolveDefaultGrokQuotaCredential(provider, rejectedAccessToken)
        }
        try {
          const resolved = await resolveLegacyRequestCredentials(
            provider.credentialSourceId,
            rejectedAccessToken
          )
          const accessToken = resolved.apiKey.trim()
          if (!accessToken || accessToken === rejectedAccessToken) return undefined
          return { accessToken }
        } catch {
          return undefined
        }
      },
      // OpenCode Go uses the default browser-cookie resolver and the shared
      // proxy-aware fetcher; explicit wiring keeps GUI/TUI quota behavior
      // identical to the standalone runtime defaults.
      resolveOpenCodeGoCookie: async () => resolveOpenCodeGoCookie(),
      fetchOpenCodeGoWebQuota: async (cookieHeader, context) => {
        const fetcher = ((input: string | URL | Request, init?: RequestInit) =>
          context.fetcher(
            typeof input === 'string' || input instanceof URL ? input : input.url,
            init,
            context.proxyUrl
          )) as typeof fetch
        return fetchOpenCodeGoWebQuota({ cookieHeader, fetcher })
      }
    }
  })
  const claudeConnections = new ClaudeConnectionService({ dataDir: core.activeOptions.dataDir })
  const modelConnectionOAuth = new ModelConnectionOAuthService({
    registry: modelConnections,
    claude: claudeConnections
  })
  const officialProviderAuth = new OfficialProviderAuthService({
    dataDir: core.activeOptions.dataDir,
    registry: modelConnections
  })
  const stopExtensionModelListener = extensionModelProviders.onDidChange(replaceRoutedModelClients)
  const hasMcpOAuth = Object.values(core.activeOptions.capabilities?.mcp?.servers ?? {}).some((server) =>
    server.oauth?.enabled !== false && Boolean(server.oauth) && server.transport !== 'stdio'
  )
  const oauthEncryptor = hasMcpOAuth
    ? extensionCredentialKeyProvider.encryptor
    : undefined
  return {
    core,
    agentSdkProviderIds,
    antigravityProviderIds,
    cursorSdkProviderIds,
    refreshDelegatedProviderIds,
    extensionProviderAccounts,
    extensionCredentialKeyProvider,
    extensionCredentials,
    extensionAccountAudit,
    extensionAccounts,
    extensionModelProviders,
    legacyCredentialMigration,
    modelConnections,
    safeCredentialUnavailableMessage,
    requestCredentialStore,
    grokCredentialRefresher,
    codexCredentialRefresher,
    resolveLegacyRequestCredentials,
    migrateLegacyProviderCredentials,
    buildApprovalReviewClients,
    initialModelClients,
    directModelClient,
    approvalReviewModelClient,
    approvalReviewService,
    routeHealth,
    modelClient,
    timedModelClient,
    routePoolTests,
    subagentRouter,
    replaceRoutedModelClients,
    resolveCapabilityProviderCredential,
    providerQuotaService,
    claudeConnections,
    modelConnectionOAuth,
    officialProviderAuth,
    stopExtensionModelListener,
    hasMcpOAuth,
    oauthEncryptor,
    get refreshModelConnectionDelegatedDeps() {
      return refreshModelConnectionDelegatedDeps
    },
    set refreshModelConnectionDelegatedDeps(value: typeof refreshModelConnectionDelegatedDeps) {
      refreshModelConnectionDelegatedDeps = value
    }
  }
}
