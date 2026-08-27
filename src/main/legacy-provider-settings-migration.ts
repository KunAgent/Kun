import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  createSecretEncryptor,
  defaultSecretCommandRunner,
  hasPersistedSecretKeyMaterial
} from '../../kun/src/security/secret-store.js'
import { ExtensionCredentialStore } from '../../kun/src/services/extension-credential-store.js'
import { LegacyProviderCredentialMigrationService } from '../../kun/src/services/legacy-provider-credential-migration.js'
import { ExtensionProviderAccountStore } from '../../kun/src/services/extension-provider-account-store.js'
import {
  modelConnectionCredentialSourceId,
  ModelConnectionRegistry
} from '../../kun/src/services/model-connection-registry.js'
import {
  CodexOAuthCredentialRefresher,
  parseStoredCodexOAuthCredentials
} from '../../kun/src/services/codex-oauth-credential-refresher.js'
import {
  GrokOAuthCredentialRefresher,
  parseStoredGrokOAuthCredentials
} from '../../kun/src/services/grok-oauth-credential-refresher.js'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  getKunRuntimeSettings,
  getModelProviderSettings,
  type AppSettingsV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import { assertManagedKunDataDirIsCurrent } from './kun-data-dir-paths'

export const LEGACY_PROVIDER_SOURCE_PREFIX = 'settings:provider:'
export const LEGACY_RUNTIME_OVERRIDE_SOURCE_ID = 'settings:runtime:override'
export const LEGACY_MEDIA_SOURCE_PREFIX = 'settings:media:'
const LEGACY_MEDIA_SERVICES = [
  'imageGeneration',
  'speechToText',
  'textToSpeech',
  'musicGeneration',
  'videoGeneration'
] as const
type LegacyMediaService = typeof LEGACY_MEDIA_SERVICES[number]

export type PreparedLegacyProviderSettingsMigration = {
  /** Ephemeral compatibility projection used by existing in-process callers. */
  runtimeSettings: AppSettingsV1
  /** Secret-free projection that is safe to write to ordinary settings. */
  persistedSettings: AppSettingsV1
  sourceIdsToCommit: string[]
  removedPlaintext: boolean
  rollback: () => Promise<void>
  commit: () => Promise<void>
}

type MigrationRuntime = {
  service: LegacyProviderCredentialMigrationService
  modelConnections: ModelConnectionRegistry
  resolveRegistryCredential: (
    providerId: string
  ) => Promise<{ authoritative: boolean; apiKey: string }>
}

type MigrationRuntimeFactory = (dataDir: string) => Promise<MigrationRuntime>

/**
 * Bridges the GUI's legacy settings shape to Kun's protected account store.
 * It intentionally leaves existing synchronous settings consumers on an
 * ephemeral compatibility projection for one release cycle; disk writes use
 * only the secret-free projection and durable account-reference bindings.
 */
export class LegacyProviderSettingsMigrationCoordinator {
  private readonly runtimes = new Map<string, Promise<MigrationRuntime>>()

  constructor(private readonly runtimeFactory: MigrationRuntimeFactory = createMigrationRuntime) {}

  async prepare(
    settings: AppSettingsV1,
    options: {
      replaceCommitted?: boolean
      previousSettings?: AppSettingsV1
    } = {}
  ): Promise<PreparedLegacyProviderSettingsMigration> {
    const dataDir = resolveSettingsDataDir(settings)
    assertManagedKunDataDirIsCurrent(dataDir)
    const { service } = await this.runtime(dataDir)
    // An empty compatibility field can also mean that a protected credential
    // temporarily failed to hydrate. Only retire sources that changed from a
    // known non-empty value in the caller's previous in-memory snapshot.
    if (options.replaceCommitted === true && options.previousSettings) {
      await service.forgetSources(collectClearedLegacyCredentialSourceIds(
        options.previousSettings,
        settings
      ))
    }
    const sources = collectLegacyCredentialSources(settings)
    const migrations = await service.migrate(sources, {
      replaceCommitted: options.replaceCommitted === true
    })
    const migratedSourceIds = new Set(migrations.map((entry) => entry.sourceId))
    const persistedSettings = stripMigratedPlaintext(settings, migratedSourceIds)
    const bindings = await service.listBindings()
    const sourceIdsToCommit = new Set(migrations.map((entry) => entry.sourceId))

    for (const binding of bindings) {
      if (binding.phase !== 'secure-committed') continue
      if (isRecognizedSettingsSource(binding.sourceId)) sourceIdsToCommit.add(binding.sourceId)
    }

    const runtimeSettings = await hydrateSettingsFromBindings(persistedSettings, service)
    const sourceIds = [...sourceIdsToCommit].sort()
    return {
      runtimeSettings,
      persistedSettings,
      sourceIdsToCommit: sourceIds,
      removedPlaintext: migrations.some((entry) => entry.removePlaintext),
      rollback: () => service.rollbackPending(sourceIds),
      commit: () => service.markSettingsCommitted(sourceIds)
    }
  }

  /**
   * Older Registry seeding could persist only an OAuth access token back into
   * a settings-owned protected source. Recover the complete refreshable value
   * from the one-time pre-migration backup, but only when the source still
   * exists and its protected static value is either that OAuth access token or
   * a rotated OpenAI token for the same issuer and ChatGPT account. A cleared
   * source or an unrelated replacement API key is never resurrected.
   */
  async repairRefreshableCredentialsFromBackup(
    settings: AppSettingsV1,
    backupSettings: AppSettingsV1
  ): Promise<string[]> {
    const dataDir = resolveSettingsDataDir(settings)
    assertManagedKunDataDirIsCurrent(dataDir)
    const { service } = await this.runtime(dataDir)
    const bindings = new Set((await service.listBindings()).map((entry) => entry.sourceId))
    const repaired: string[] = []

    for (const source of collectRefreshableOAuthRecoverySources(settings, backupSettings)) {
      if (!bindings.has(source.sourceId)) continue
      const current = await service.resolveApiKey(source.sourceId, {
        includeUnavailable: true
      }).catch(() => null)
      if (!current) continue
      if (isRefreshableOAuthCredential(current.apiKey)) continue
      if (!staticCredentialMatchesRefreshableBackup(current.apiKey, source.apiKey)) continue

      const migrations = await service.migrate([source], { replaceCommitted: true })
      if (!migrations.some((entry) => entry.sourceId === source.sourceId)) continue
      await service.markSettingsCommitted([source.sourceId])
      repaired.push(source.sourceId)
    }

    return repaired.sort()
  }

  private runtime(dataDir: string): Promise<MigrationRuntime> {
    let pending = this.runtimes.get(dataDir)
    if (!pending) {
      pending = this.runtimeFactory(dataDir)
      this.runtimes.set(dataDir, pending)
      void pending.catch(() => {
        if (this.runtimes.get(dataDir) === pending) this.runtimes.delete(dataDir)
      })
    }
    return pending
  }

  invalidateRuntime(dataDir: string): void {
    this.runtimes.delete(dataDir)
  }

  /**
   * Produces a short-lived Main-only settings view for legacy request paths.
   * Registry credentials never enter ordinary settings or bulk renderer IPC;
   * the trusted workbench may request one provider explicitly for UI reveal.
   */
  async withRegistryCredentials(
    settings: AppSettingsV1,
    providerIds?: readonly string[]
  ): Promise<AppSettingsV1> {
    const dataDir = resolveSettingsDataDir(settings)
    assertManagedKunDataDirIsCurrent(dataDir)
    const { resolveRegistryCredential, service } = await this.runtime(dataDir)
    const projected = await projectRegistryCredentials(settings, resolveRegistryCredential, providerIds)
    return projectRegistryMediaCredentials(projected, (sourceId) => resolveLegacyApiKey(service, sourceId))
  }
}

export async function projectRegistryCredentials(
  settings: AppSettingsV1,
  resolve: (providerId: string) => Promise<{ authoritative: boolean; apiKey: string }>,
  providerIds?: readonly string[]
): Promise<AppSettingsV1> {
  const providerSettings = getModelProviderSettings(settings)
  const selectedProviderId = getKunRuntimeSettings(settings).providerId
  const requestedProviderIds = providerIds ? new Set(providerIds) : null
  let registrySelectedProvider = false
  const providers: ModelProviderProfileV1[] = []
  for (const provider of providerSettings.providers) {
    if (requestedProviderIds && !requestedProviderIds.has(provider.id)) {
      providers.push(provider)
      continue
    }
    const state = await resolve(provider.id)
    if (!state.authoritative) {
      providers.push(provider)
      continue
    }
    if (selectedProviderId === provider.id) registrySelectedProvider = true
    providers.push({ ...provider, apiKey: state.apiKey })
  }
  const defaultProvider = providers.find((provider) => provider.id === DEFAULT_MODEL_PROVIDER_ID) ?? providers[0]
  return {
    ...settings,
    provider: {
      ...providerSettings,
      apiKey: defaultProvider?.apiKey ?? '',
      providers
    },
    ...(registrySelectedProvider
      ? {
          agents: {
            ...settings.agents,
            kun: { ...getKunRuntimeSettings(settings), apiKey: '' }
          }
        }
      : {})
  }
}

export async function projectRegistryMediaCredentials(
  settings: AppSettingsV1,
  resolve: (sourceId: string) => Promise<{ apiKey: string } | null>
): Promise<AppSettingsV1> {
  const runtime = getKunRuntimeSettings(settings)
  const media = await Promise.all(mediaSettings(runtime).map(async ([service, value]) => {
    const credential = await resolve(legacyMediaCredentialSourceId(service))
    return [service, credential ? { ...value, apiKey: credential.apiKey } : value] as const
  }))
  return {
    ...settings,
    agents: { ...settings.agents, kun: { ...runtime, ...Object.fromEntries(media) } }
  }
}

export function legacyProviderCredentialSourceId(providerId: string): string {
  return `${LEGACY_PROVIDER_SOURCE_PREFIX}${providerId.trim()}`
}

export function legacyMediaCredentialSourceId(service: LegacyMediaService): string {
  return `${LEGACY_MEDIA_SOURCE_PREFIX}${service}`
}

function mediaSettings(runtime: ReturnType<typeof getKunRuntimeSettings>) {
  return LEGACY_MEDIA_SERVICES.map((service) => [service, runtime[service]] as const)
}

function collectLegacyCredentialSources(settings: AppSettingsV1) {
  const providerSettings = getModelProviderSettings(settings)
  const runtime = getKunRuntimeSettings(settings)
  const sources = providerSettings.providers
    .filter((provider) => provider.apiKey.trim())
    .map((provider) => ({
      sourceId: legacyProviderCredentialSourceId(provider.id),
      providerId: provider.id,
      providerName: provider.name,
      label: `${provider.name} legacy provider credential`,
      apiKey: provider.apiKey,
      ...(preferredProviderModel(provider, runtime.model) ? {
        modelId: preferredProviderModel(provider, runtime.model)
      } : {})
    }))

  if (runtime.apiKey.trim()) {
    const providerId = runtime.providerId.trim() || providerSettings.providers[0]?.id || DEFAULT_MODEL_PROVIDER_ID
    const provider = providerSettings.providers.find((entry) => entry.id === providerId)
    sources.push({
      sourceId: LEGACY_RUNTIME_OVERRIDE_SOURCE_ID,
      providerId,
      providerName: provider?.name ?? providerId,
      label: 'Kun legacy runtime override',
      apiKey: runtime.apiKey,
      ...(runtime.model.trim() ? { modelId: runtime.model.trim() } : {})
    })
  }
  for (const [service, media] of mediaSettings(runtime)) {
    if (!media.apiKey.trim()) continue
    sources.push({
      sourceId: legacyMediaCredentialSourceId(service),
      providerId: `media:${service}`,
      providerName: `Kun ${service}`,
      label: `Kun ${service} credential`,
      apiKey: media.apiKey,
      ...(media.model.trim() ? { modelId: media.model.trim() } : {})
    })
  }
  return sources
}

function collectRefreshableOAuthRecoverySources(
  settings: AppSettingsV1,
  backupSettings: AppSettingsV1
) {
  const currentProviders = new Map(
    getModelProviderSettings(settings).providers.map((provider) => [provider.id, provider])
  )
  const runtime = getKunRuntimeSettings(settings)
  return getModelProviderSettings(backupSettings).providers.flatMap((backupProvider) => {
    const current = currentProviders.get(backupProvider.id)
    if (!current || !isRefreshableOAuthCredential(backupProvider.apiKey)) return []
    return [{
      sourceId: legacyProviderCredentialSourceId(current.id),
      providerId: current.id,
      providerName: current.name,
      label: `${current.name} recovered OAuth credential`,
      apiKey: backupProvider.apiKey,
      ...(preferredProviderModel(current, runtime.model) ? {
        modelId: preferredProviderModel(current, runtime.model)
      } : {})
    }]
  })
}

function isRefreshableOAuthCredential(rawApiKey: string): boolean {
  return parseStoredCodexOAuthCredentials(rawApiKey) !== null ||
    parseStoredGrokOAuthCredentials(rawApiKey) !== null
}

function staticCredentialMatchesRefreshableBackup(
  staticApiKey: string,
  rawBackup: string
): boolean {
  const value = staticApiKey.trim()
  const codex = parseStoredCodexOAuthCredentials(rawBackup)
  if (codex) {
    if (value === codex.accessToken) return true
    const claims = parseJwtClaims(value)
    return claims?.iss === 'https://auth.openai.com' &&
      codexAccountIdFromClaims(claims) === codex.accountId
  }
  const grok = parseStoredGrokOAuthCredentials(rawBackup)
  return grok !== null && value === grok.accessToken
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function codexAccountIdFromClaims(claims: Record<string, unknown>): string {
  if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id
  const auth = claims['https://api.openai.com/auth']
  if (auth && typeof auth === 'object' && !Array.isArray(auth)) {
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id
    if (typeof accountId === 'string') return accountId
  }
  if (Array.isArray(claims.organizations)) {
    const organization = claims.organizations[0]
    if (organization && typeof organization === 'object' && !Array.isArray(organization)) {
      const accountId = (organization as Record<string, unknown>).id
      if (typeof accountId === 'string') return accountId
    }
  }
  return ''
}

/** Source ids explicitly cleared between two trusted in-memory settings snapshots. */
function collectClearedLegacyCredentialSourceIds(
  previous: AppSettingsV1,
  current: AppSettingsV1
): string[] {
  const previousProviders = new Map(
    getModelProviderSettings(previous).providers.map((provider) => [provider.id, provider])
  )
  const currentProviders = new Map(
    getModelProviderSettings(current).providers.map((provider) => [provider.id, provider])
  )
  const sourceIds: string[] = []
  for (const [providerId, provider] of previousProviders) {
    const currentProvider = currentProviders.get(providerId)
    if (!currentProvider || (provider.apiKey.trim() && !currentProvider.apiKey.trim())) {
      sourceIds.push(legacyProviderCredentialSourceId(providerId))
    }
  }
  if (
    getKunRuntimeSettings(previous).apiKey.trim() &&
    !getKunRuntimeSettings(current).apiKey.trim()
  ) sourceIds.push(LEGACY_RUNTIME_OVERRIDE_SOURCE_ID)
  for (const [service, media] of mediaSettings(getKunRuntimeSettings(previous))) {
    const next = getKunRuntimeSettings(current)[service]
    if (media.apiKey.trim() && !next.apiKey.trim()) {
      sourceIds.push(legacyMediaCredentialSourceId(service))
    }
  }
  return sourceIds
}

function stripMigratedPlaintext(
  settings: AppSettingsV1,
  migratedSourceIds: ReadonlySet<string>
): AppSettingsV1 {
  const provider = getModelProviderSettings(settings)
  const providers = provider.providers.map((entry) => migratedSourceIds.has(legacyProviderCredentialSourceId(entry.id))
    ? { ...entry, apiKey: '' }
    : entry)
  const defaultProvider = providers.find((entry) => entry.id === DEFAULT_MODEL_PROVIDER_ID) ?? providers[0]
  const runtime = getKunRuntimeSettings(settings)
  const media = Object.fromEntries(mediaSettings(runtime).map(([service, value]) => [
    service,
    migratedSourceIds.has(legacyMediaCredentialSourceId(service)) ? { ...value, apiKey: '' } : value
  ])) as Pick<typeof runtime, LegacyMediaService>
  return {
    ...settings,
    provider: {
      ...provider,
      apiKey: migratedSourceIds.has(legacyProviderCredentialSourceId(DEFAULT_MODEL_PROVIDER_ID))
        ? ''
        : defaultProvider?.apiKey ?? provider.apiKey,
      providers
    },
    agents: {
      ...settings.agents,
      kun: {
        ...(migratedSourceIds.has(LEGACY_RUNTIME_OVERRIDE_SOURCE_ID)
          ? { ...runtime, apiKey: '' }
          : runtime),
        ...media
      }
    }
  }
}

async function hydrateSettingsFromBindings(
  settings: AppSettingsV1,
  service: LegacyProviderCredentialMigrationService
): Promise<AppSettingsV1> {
  const provider = getModelProviderSettings(settings)
  const providers: ModelProviderProfileV1[] = []
  for (const entry of provider.providers) {
    const resolved = await resolveLegacyApiKey(
      service,
      legacyProviderCredentialSourceId(entry.id)
    )
    providers.push(resolved ? { ...entry, apiKey: resolved.apiKey } : entry)
  }
  const defaultProvider = providers.find((entry) => entry.id === DEFAULT_MODEL_PROVIDER_ID) ?? providers[0]
  const runtime = getKunRuntimeSettings(settings)
  const runtimeOverride = await resolveLegacyApiKey(service, LEGACY_RUNTIME_OVERRIDE_SOURCE_ID)
  const hydratedMedia = await Promise.all(mediaSettings(runtime).map(async ([mediaService, value]) => {
    const resolved = await resolveLegacyApiKey(service, legacyMediaCredentialSourceId(mediaService))
    return [mediaService, resolved ? { ...value, apiKey: resolved.apiKey } : value] as const
  }))
  return {
    ...settings,
    provider: {
      ...provider,
      apiKey: defaultProvider?.apiKey ?? '',
      providers
    },
    agents: {
      ...settings.agents,
      kun: {
        ...(runtimeOverride ? { ...runtime, apiKey: runtimeOverride.apiKey } : runtime),
        ...Object.fromEntries(hydratedMedia)
      }
    }
  }
}

async function resolveLegacyApiKey(
  service: LegacyProviderCredentialMigrationService,
  sourceId: string
): Promise<Awaited<ReturnType<LegacyProviderCredentialMigrationService['resolveApiKey']>>> {
  try {
    return await service.resolveApiKey(sourceId)
  } catch (error) {
    // Credential records can outlive the key that encrypted them after an OS
    // keychain reset, profile restore, or copied data directory. One unreadable
    // legacy record must not make settings:set fail for a different provider:
    // keep that profile unhydrated so the user can replace its key explicitly.
    console.warn('[kun-gui] Legacy provider credential could not be restored; the saved profile will require a new key.', {
      sourceId,
      message: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

function preferredProviderModel(provider: ModelProviderProfileV1, runtimeModel: string): string | undefined {
  const selected = runtimeModel.trim()
  if (selected && provider.models.includes(selected)) return selected
  return provider.models.find((model) => model.trim())?.trim()
}

function isRecognizedSettingsSource(sourceId: string): boolean {
  return sourceId === LEGACY_RUNTIME_OVERRIDE_SOURCE_ID ||
    sourceId.startsWith(LEGACY_PROVIDER_SOURCE_PREFIX) ||
    sourceId.startsWith(LEGACY_MEDIA_SOURCE_PREFIX)
}

export function resolveSettingsDataDir(settings: AppSettingsV1): string {
  const value = getKunRuntimeSettings(settings).dataDir.trim()
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return join(homedir(), value.slice(2).replace(/\\/g, '/'))
  }
  return value
}

async function createMigrationRuntime(dataDir: string): Promise<MigrationRuntime> {
  const keyProvider = await createSecretEncryptor({
    keyFilePath: join(dataDir, 'secret.key'),
    run: defaultSecretCommandRunner,
    canBootstrapKeyFileFallback: async () => !(await hasPersistedSecretKeyMaterial(dataDir))
  })
  const accounts = new ExtensionProviderAccountStore({ dataDir })
  const credentials = new ExtensionCredentialStore({
    dataDir,
    profileId: 'default',
    keyProvider
  })
  const modelConnections = new ModelConnectionRegistry({ dataDir, credentials })
  const requestCredentialStore = {
    resolveApiKey: (sourceId: string) => modelConnections.resolveApiKey(sourceId),
    updateResolvedApiKey: (sourceId: string, expectedApiKey: string, apiKey: string) =>
      modelConnections.updateResolvedApiKey(sourceId, expectedApiKey, apiKey)
  }
  const codexCredentialRefresher = new CodexOAuthCredentialRefresher(requestCredentialStore)
  const grokCredentialRefresher = new GrokOAuthCredentialRefresher(requestCredentialStore)
  return {
    modelConnections,
    resolveRegistryCredential: async (providerId) => {
      const state = await modelConnections.credentialStateForInternalConsumer(providerId)
      if (!state.authoritative || !state.apiKey) return state
      const sourceId = modelConnectionCredentialSourceId(providerId)
      let resolved = await codexCredentialRefresher.resolve(sourceId)
      if (!resolved.refreshable) resolved = await grokCredentialRefresher.resolve(sourceId)
      return { authoritative: true, apiKey: resolved.rawApiKey }
    },
    service: new LegacyProviderCredentialMigrationService({
      dataDir,
      accounts,
      credentials
    })
  }
}
