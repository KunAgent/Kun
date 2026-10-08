import { join } from 'node:path'
import type { z } from 'zod'
import {
  ClaudeSdkInstallStatusSchema,
  ModelConnectionCliAuthRequestSchema,
  ModelConnectionConnectRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionOAuthStartRequestSchema,
  ModelConnectionOAuthStatusSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  RuntimeConfigApplyRequest,
  type ModelConnectionSnapshot,
  type RuntimeConfigApplyResponse
} from '../contracts/index.js'
import {
  modelConnectionSnapshotFromGuiSettings,
  projectModelConnectionsToGuiSettings,
  syncGuiProviderCatalogToConfig,
  type GuiSharedSettings
} from '../cli/gui-settings-bridge.js'
import { createSecretEncryptor, defaultSecretCommandRunner } from '../security/secret-store.js'
import { ExtensionCredentialStore } from '../services/extension-credential-store.js'
import { ExtensionProviderAccountStore } from '../services/extension-provider-account-store.js'
import { ClaudeConnectionService } from '../services/claude-connection-service.js'
import {
  LegacyProviderCredentialMigrationService,
  type LegacyProviderCredentialSource
} from '../services/legacy-provider-credential-migration.js'
import {
  ModelConnectionConflictError,
  ModelConnectionRegistry,
  type MaterializedModelConnections
} from '../services/model-connection-registry.js'
import { ModelConnectionOAuthService } from '../services/model-connection-oauth.js'
import { OfficialProviderAuthService } from '../services/official-provider-cli.js'
import { TuiClientError, type ModelConnectionTransport } from './client.js'
import { modelCapabilitiesForProviderModel } from '../loop/model-context-profile.js'

const SETTINGS_PROVIDER_PREFIX = 'settings:provider:'

export type LegacyModelConnectionTransportOptions = {
  dataDir: string
  guiSettings: GuiSharedSettings
  applyRuntimeConfig: (input: z.input<typeof RuntimeConfigApplyRequest>) => Promise<RuntimeConfigApplyResponse>
  fetch?: typeof fetch
  /** Test/non-interactive override; production defaults to the OS store. */
  disableOsKeychain?: boolean
  notify?: (message: string, kind: 'info' | 'error') => void
}

/**
 * Keeps `/connect` functional while an authenticated pre-discovery GUI
 * runtime is active. This object owns no agent loop, thread store, event bus,
 * or HTTP listener; it only adapts model-connection persistence to the same
 * protected files used by current runtimes and hot-applies the existing one.
 */
export class LegacyModelConnectionTransport implements ModelConnectionTransport {
  private settings: GuiSharedSettings
  private closed = false
  private syncQueue: Promise<void> = Promise.resolve()

  private constructor(
    private readonly options: LegacyModelConnectionTransportOptions,
    private readonly registry: ModelConnectionRegistry,
    private readonly migration: LegacyProviderCredentialMigrationService,
    private readonly oauth: ModelConnectionOAuthService,
    private readonly officialProviderAuth: OfficialProviderAuthService,
    private readonly claude: ClaudeConnectionService
  ) {
    this.settings = options.guiSettings
  }

  static async create(options: LegacyModelConnectionTransportOptions): Promise<LegacyModelConnectionTransport> {
    const keyProvider = await createSecretEncryptor({
      keyFilePath: join(options.dataDir, 'secret.key'),
      run: defaultSecretCommandRunner,
      ...(options.disableOsKeychain !== undefined ? { disableOsKeychain: options.disableOsKeychain } : {})
    })
    const accounts = new ExtensionProviderAccountStore({ dataDir: options.dataDir })
    const credentials = new ExtensionCredentialStore({
      dataDir: options.dataDir,
      profileId: 'default',
      keyProvider
    })
    const migration = new LegacyProviderCredentialMigrationService({
      dataDir: options.dataDir,
      accounts,
      credentials
    })
    const guiSnapshot = modelConnectionSnapshotFromGuiSettings(options.guiSettings)
    const seeds = await Promise.all(guiSnapshot.providers.map(async (profile) => {
      const credential = await resolveImportedCredential(
        migration,
        profile.id,
        profile.id === guiSnapshot.defaultProviderId
      )
      return {
        expectedRevision: 0,
        id: profile.id,
        name: profile.name,
        presetSource: profile.presetSource ?? profile.id,
        kind: profile.kind,
        authType: profile.authType,
        ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
        endpointFormat: profile.endpointFormat,
        ...(credential ? { credential } : {}),
        models: profile.models,
        ...(profile.modelCapabilities ? { modelCapabilities: profile.modelCapabilities } : {}),
        ...(profile.selectedModel ? { selectedModel: profile.selectedModel } : {}),
        probe: false,
        select: profile.id === guiSnapshot.defaultProviderId
      }
    }))
    let transport: LegacyModelConnectionTransport | undefined
    let initializing = true
    const registry = new ModelConnectionRegistry({
      dataDir: options.dataDir,
      credentials,
      modelCapabilities: (model, profile) => modelCapabilitiesForProviderModel({
        providerId: profile?.id,
        presetSource: profile?.presetSource,
        baseUrl: profile?.baseUrl,
        kind: profile?.kind,
        model
      }),
      onChanged: async (connections) => {
        if (!initializing) await transport?.scheduleSync(connections)
      }
    })
    await registry.initialize(seeds)
    const claude = new ClaudeConnectionService({ dataDir: options.dataDir })
    const oauth = new ModelConnectionOAuthService({
      registry,
      claude,
      ...(options.fetch ? { fetch: options.fetch } : {})
    })
    const officialProviderAuth = new OfficialProviderAuthService({
      dataDir: options.dataDir,
      registry
    })
    transport = new LegacyModelConnectionTransport(
      options,
      registry,
      migration,
      oauth,
      officialProviderAuth,
      claude
    )
    initializing = false
    return transport
  }

  modelConnections(): Promise<ModelConnectionSnapshot> {
    return this.registry.snapshot()
  }

  async subscribeModelConnections(input: Parameters<ModelConnectionTransport['subscribeModelConnections']>[0]): Promise<void> {
    let revision = Math.max(0, input.sinceRevision)
    let metadataRevision = Math.max(0, input.sinceMetadataRevision ?? 0)
    const sleep = input.sleep ?? abortableDelay
    while (!input.signal.aborted && !this.closed) {
      try {
        const snapshot = await this.registry.snapshot()
        if (snapshot.revision > revision || (snapshot.metadataRevision ?? 0) > metadataRevision) {
          revision = snapshot.revision
          metadataRevision = snapshot.metadataRevision ?? 0
          await input.onSnapshot(snapshot)
        }
      } catch (error) {
        input.onError?.(asError(error))
      }
      if (!input.signal.aborted && !this.closed) await sleep(750, input.signal)
    }
  }

  connectModel(input: z.input<typeof ModelConnectionConnectRequestSchema>): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.registry.connect(input))
  }

  patchModel(providerId: string, input: z.input<typeof ModelConnectionPatchRequestSchema>): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.registry.patch(providerId, input))
  }

  replaceModelCredential(providerId: string, input: z.input<typeof ModelConnectionCredentialRequestSchema>): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.registry.replaceCredential(providerId, input))
  }

  deleteModel(providerId: string, expectedRevision: number): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.registry.delete(providerId, expectedRevision))
  }

  probeModel(providerId: string): Promise<{ ok: true; models: string[] }> {
    return this.registry.probe(providerId)
  }

  selectModel(input: z.input<typeof ModelConnectionSelectRequestSchema>): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.registry.select(input))
  }

  completeModelCliAuth(
    input: z.input<typeof ModelConnectionCliAuthRequestSchema>
  ): Promise<ModelConnectionSnapshot> {
    return this.mutation(() => this.officialProviderAuth.complete(input))
  }

  startModelOAuth(input: z.input<typeof ModelConnectionOAuthStartRequestSchema>) {
    return this.mutation(() => this.oauth.start(input))
  }

  modelOAuthStatus(sessionId: string) {
    return this.oauth.status(sessionId)
  }

  submitModelOAuth(sessionId: string, code: string) {
    return this.mutation(() => this.oauth.submit(sessionId, code))
  }

  async cancelModelOAuth(sessionId: string) {
    return ModelConnectionOAuthStatusSchema.parse(this.oauth.cancel(sessionId))
  }

  claudeSdkStatus(): Promise<z.infer<typeof ClaudeSdkInstallStatusSchema>> {
    return this.claude.status()
  }

  installClaudeSdk(): Promise<z.infer<typeof ClaudeSdkInstallStatusSchema>> {
    return this.claude.install()
  }

  async close(): Promise<void> {
    this.closed = true
    this.oauth.close()
    await this.syncQueue.catch(() => undefined)
  }

  private async mutation<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof ModelConnectionConflictError) {
        throw new TuiClientError(
          'model connection registry revision changed',
          409,
          'revision_conflict',
          '/v1/model-connections'
        )
      }
      throw error
    }
  }

  private scheduleSync(_connections: MaterializedModelConnections): Promise<void> {
    const task = this.syncQueue.then(() => this.syncCompatibility())
    this.syncQueue = task.catch((error) => {
      this.options.notify?.(
        `Connection was saved securely, but legacy runtime synchronization needs attention: ${safeError(error)}`,
        'error'
      )
    })
    return this.syncQueue
  }

  private async syncCompatibility(): Promise<void> {
    const snapshot = await this.registry.snapshot()
    const sources: LegacyProviderCredentialSource[] = []
    for (const profile of snapshot.providers) {
      const credential = await this.registry.credentialForCompatibility(profile.id)
      if (!credential) continue
      sources.push({
        sourceId: `${SETTINGS_PROVIDER_PREFIX}${profile.id}`,
        providerId: profile.id,
        providerName: profile.name,
        label: `${profile.name} TUI connection credential`,
        apiKey: credential,
        ...(profile.selectedModel ? { modelId: profile.selectedModel } : {})
      })
    }
    const migrations = await this.migration.migrate(sources, { replaceCommitted: true })
    const sourceIds = migrations.map((entry) => entry.sourceId)
    const currentProviderIds = new Set(snapshot.providers.map((profile) => profile.id))
    for (const binding of await this.migration.listBindings()) {
      if (!binding.sourceId.startsWith(SETTINGS_PROVIDER_PREFIX)) continue
      if (!currentProviderIds.has(binding.providerId)) await this.migration.remove(binding.sourceId)
    }
    try {
      const protectedProviderIds = new Set(migrations.map((entry) => entry.providerId))
      for (const binding of await this.migration.listBindings()) {
        if (binding.sourceId.startsWith(SETTINGS_PROVIDER_PREFIX)) protectedProviderIds.add(binding.providerId)
      }
      this.settings = await projectModelConnectionsToGuiSettings(this.settings, snapshot, {
        protectedProviderIds
      })
      const config = await syncGuiProviderCatalogToConfig(this.options.dataDir, this.settings, {
        authoritative: true,
        stripCredentials: true
      })
      if (!config) throw new Error('GUI and runtime data directories no longer match')
      await this.migration.markSettingsCommitted(sourceIds)
      const applied = await this.options.applyRuntimeConfig(config.applyRequest)
      if (!applied.ok) {
        this.options.notify?.(
          `Connection saved. The active legacy runtime requires a restart: ${applied.message}`,
          'info'
        )
      } else {
        this.options.notify?.('Provider connection updated in the active runtime.', 'info')
      }
    } catch (error) {
      await this.migration.rollbackPending(sourceIds).catch(() => undefined)
      throw error
    }
  }
}

async function resolveImportedCredential(
  migration: LegacyProviderCredentialMigrationService,
  providerId: string,
  isDefault: boolean
): Promise<string | undefined> {
  const sourceIds = [
    `${SETTINGS_PROVIDER_PREFIX}${providerId}`,
    `runtime:provider:${providerId}`,
    ...(isDefault ? ['runtime:default'] : [])
  ]
  for (const sourceId of sourceIds) {
    const resolved = await migration.resolveApiKey(sourceId).catch(() => null)
    if (resolved?.apiKey?.trim()) return resolved.apiKey
  }
  return undefined
}

export async function createLegacyModelConnectionTransport(
  options: LegacyModelConnectionTransportOptions
): Promise<LegacyModelConnectionTransport> {
  return LegacyModelConnectionTransport.create(options)
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms)
    const abort = (): void => finish()
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
