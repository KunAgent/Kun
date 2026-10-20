import { modelCatalogRevisionFile } from './model-catalog-revision.js'
import { migrateModelMetadata, resolveModelMetadata, withModelObservation } from './model-metadata-resolver.js'
import { metadataEvidence } from '../contracts/model-metadata-evidence.js'
import { assertProviderConfigurationUrls } from '../contracts/provider-safe-url.js'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { ProviderConfigurationStateSchema } from '../contracts/provider-configuration.js'
import { PROVIDER_REGISTRY_FILE, upgradeProviderRegistry } from './provider-registry-migration.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { providerConfigurationSecretOperations } from './provider-configuration-secret-operations.js'
import type { ProviderSecretBinding } from './provider-configuration-backup.js'
import { providerConfigurationOperations, type ConfigurationPreview } from './provider-configuration-operations.js'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import type { ServeProviderConfig } from '../config/kun-config.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { normalizeModelCapabilityMetadata, enforceProviderModelSafety } from './model-capability-limits.js'
import {
  ModelConnectionConnectRequestSchema,
  ModelConnectionCredentialCommitRequestSchema,
  ModelConnectionCredentialFenceRequestSchema,
  ModelConnectionCredentialPrepareRequestSchema,
  ModelConnectionCredentialRequestSchema,
  ModelConnectionGlobalsRequestSchema,
  ModelConnectionPatchRequestSchema,
  ModelConnectionSelectRequestSchema,
  ModelConnectionSnapshotSchema,
  type ModelConnectionConnectRequest,
  type ModelConnectionCredentialErrorCode,
  type ModelConnectionCredentialStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import { materializeLegacyProviderCredential } from './legacy-provider-credential-migration.js'
import type { ExtensionCredentialStore } from './extension-credential-store.js'
export { probeModels, modelsUrl } from './model-connection-probe.js'
import { installServiceOperations } from './service-operation-install.js'
import { modelConnectionRegistryConnectionOperations } from './model-connection-registry-connection-operations.js'
import { modelConnectionRegistryCredentialMutationOperations } from './model-connection-registry-credential-mutation-operations.js'
import { modelConnectionRegistrySelectionOperations } from './model-connection-registry-selection-operations.js'
import { modelConnectionRegistryMaterializationOperations } from './model-connection-registry-materialization-operations.js'
import { modelConnectionRegistryCredentialRecoveryOperations } from './model-connection-registry-credential-recovery-operations.js'
import { upgradeRegistryProxyRouting } from './model-connection-registry-proxy.js'
import { reconciledSeedIdentity } from './model-connection-registry-seed-support.js'
import type { ModelConnectionRegistryOperations } from './model-connection-registry-operations-contract.js'
import { RegistrySnapshotCache } from './model-connection-registry-snapshot-cache.js'
import {
  isAnonymousHttpProfile,
  isProfileUsable,
  isRetiredOpenCodeFreeConnection
} from './model-connection-registry-usability.js'
export {
  configuredFallback,
  isAnonymousHttpProfile,
  isProfileUsable,
  isRetiredOpenCodeFreeConnection
} from './model-connection-registry-usability.js'

export const StoredProfileSchema = ModelConnectionSnapshotSchema.shape.providers.element.omit({
  credentialStatus: true,
  credentialErrorCode: true
}).extend({
  incarnationId: z.string().uuid().optional(),
  credentialMutationHighWater: z.record(
    z.string().uuid(),
    z.number().int().positive()
  ).optional(),
  credentialRef: z.string().min(1).max(256).optional(),
  credentialSourceId: z.string().min(1).max(256).optional(),
  legacyCredentialSourceToRetire: z.string().min(1).max(256).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  headersRef: z.string().min(1).max(256).optional(),
  customHeaders: z.record(z.string(), z.string()).optional(),
  customHeadersRef: z.string().min(1).max(256).optional()
})
export const DeletedProfileTombstoneSchema = z.object({
  deletedRevision: z.number().int().nonnegative(),
  credentialMutationHighWater: z.record(
    z.string().uuid(),
    z.number().int().positive()
  ).optional(),
  legacyCredentialSourceToRetire: z.string().min(1).max(256).optional()
}).strict()
export const CredentialTransactionPreviousSchema = z.object({
  credentialRef: z.string().min(1).max(256).optional(),
  credentialSourceId: z.string().min(1).max(256).optional(),
  legacyCredentialSourceToRetire: z.string().min(1).max(256).optional(),
  configured: z.boolean()
}).strict()
export const CredentialTransactionSchema = z.object({
  operationToken: z.string().min(1).max(128),
  clientId: z.string().uuid(),
  generation: z.number().int().positive(),
  incarnationId: z.string().uuid(),
  phase: z.enum(['fenced', 'prepared', 'committing', 'recovering']),
  expiresAt: z.number().int().nonnegative(),
  previous: CredentialTransactionPreviousSchema,
  nextCredentialRef: z.string().min(1).max(256).optional(),
  writerInstanceId: z.string().uuid().optional(),
  writerPid: z.number().int().positive().optional(),
  recoveryOwnerId: z.string().uuid().optional(),
  recoveryOwnerPid: z.number().int().positive().optional()
}).strict()
export const CredentialRefCleanupEntrySchema = z.object({
  reference: z.string().min(1).max(256),
  enqueuedAt: z.number().int().nonnegative(),
  writerInstanceId: z.string().uuid().optional(),
  writerPid: z.number().int().positive().optional()
}).strict()
export const RegistryDocumentSchema = z.object({
  schemaVersion: z.literal(2),
  modelMetadataVersion: z.literal(1).optional(),
  configuration: ProviderConfigurationStateSchema.default(() => ProviderConfigurationStateSchema.parse({})),
  proxyRoutingVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  profiles: z.record(z.string(), StoredProfileSchema),
  tombstones: z.record(z.string(), DeletedProfileTombstoneSchema).default({}),
  credentialTransactions: z.record(z.string(), CredentialTransactionSchema).default({}),
  credentialRefCleanup: z.record(
    z.string().min(1).max(256),
    CredentialRefCleanupEntrySchema
  ).default({}),
  defaultProviderId: z.string().min(1).optional(),
  defaultAccountId: z.string().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
  proxy: ModelConnectionSnapshotSchema.shape.proxy,
  routePools: ModelConnectionSnapshotSchema.shape.routePools,
  failover: ModelConnectionSnapshotSchema.shape.failover,
  localModelGateway: ModelConnectionSnapshotSchema.shape.localModelGateway
}).strict()
export type RegistryDocument = z.infer<typeof RegistryDocumentSchema>
export type StoredProfile = z.infer<typeof StoredProfileSchema>
export type CredentialTransaction = z.infer<typeof CredentialTransactionSchema>
export type PreparedCredentialSecret = {
  operationToken: string
  incarnationId: string
  credential: string
}

export type ModelConnectionSeed = Omit<ModelConnectionConnectRequest, 'useProxy'> & {
  useProxy?: boolean
  /** Trusted runtime-only binding; never accepted by public connection APIs. */
  credentialSourceId?: string
}

export type AuthenticatedModelConnectionInput = Omit<
  ModelConnectionConnectRequest,
  'credential' | 'probe' | 'useProxy'
> & {
  /**
   * Credential material produced by a runtime-owned OAuth/SDK flow. Official
   * CLI providers omit this only after the service has verified their
   * provider-owned login.
   */
  credential?: string
  useProxy?: boolean
  externalAuthVerified?: boolean
}

export const MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX = 'model-connection:'

export function isModelConnectionCredentialSourceId(sourceId: string): boolean {
  return sourceId.startsWith(MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX) &&
    sourceId.length > MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX.length
}

export function modelConnectionCredentialSourceId(providerId: string): string {
  return `${MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX}${providerId}`
}

export function providerIdFromCredentialSource(sourceId: string): string | null {
  if (!isModelConnectionCredentialSourceId(sourceId)) return null
  return sourceId.slice(MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX.length)
}

export class ModelConnectionConflictError extends Error {
  constructor(readonly snapshot: ModelConnectionSnapshot) {
    super('model connection registry revision changed')
    this.name = 'ModelConnectionConflictError'
  }
}

export type MaterializedModelConnections = {
  registryRevision?: number
  selected?: { profile: StoredProfile; config: ServeProviderConfig; model: string }
  providers: Map<string, ServeProviderConfig>
  proxy: RegistryDocument['proxy']
  routePools: RegistryDocument['routePools']
  failover: RegistryDocument['failover']
  localModelGateway: RegistryDocument['localModelGateway']
}

export class ModelConnectionRegistry {
  /** Drops the memoized snapshot after an input outside the Registry changed (model profiles). */
  invalidateSnapshotCache(): void {
    this.snapshotCache.invalidate()
  }

  /** Revisions a watcher compares, without projecting the snapshot. */
  async revisionHead(): Promise<{ revision: number; metadataRevision: number }> {
    const [document, metadata] = await Promise.all([
      this.file.read(emptyDocument),
      this.metadataRevisionFile.read(() => ({ revision: 0 }))
    ])
    return { revision: document.revision, metadataRevision: metadata.revision }
  }

  async assertActiveConfiguration(revision?: number): Promise<void> {
    let document = await this.file.read(emptyDocument)
    if (this.lastAppliedRevision < document.revision) {
      // Another registry instance on the same data dir (Electron Main OAuth
      // refresh, TUI) can advance the durable revision without notifying this
      // process. Catch up before refusing dispatch, or the gate stays shut.
      await this.applyLatest().catch(() => undefined)
      document = await this.file.read(emptyDocument)
    }
    if (this.lastAppliedRevision !== document.revision || (revision !== undefined && revision !== document.revision)) {
      throw new Error('Provider configuration is not active; retry after settings finish applying')
    }
  }

  declare private connectInternal: (raw: unknown, credentialSourceId?: string, trustedExternalAuth?: boolean) => Promise<ModelConnectionSnapshot>
  declare private migrateLegacyRegistry: () => Promise<void>
  declare private materializeDocument: (document: RegistryDocument, recoveryProviderId?: string) => Promise<MaterializedModelConnections>
  declare private probeInput: (input: ModelConnectionConnectRequest) => Promise<string[]>
  declare private apply: (document: RegistryDocument) => Promise<void>
  declare private retryLegacyCredentialSourceRetirements: () => Promise<void>
  declare private retireLegacyCredentialSource: (providerId: string) => Promise<void>
  declare private retireDeletedLegacyCredentialSource: (providerId: string) => Promise<void>
  declare private changed: (_document: RegistryDocument) => Promise<void>
  declare private nowMs: () => number
  declare private credentialFenceTtlMs: () => number
  declare private clearPreparedCredentialSecret: (providerId: string, operationToken?: string) => void
  declare private schedulePreparedCredentialSecretExpiry: (providerId: string, operationToken: string, expiresAt: number) => void
  declare private cancelCredentialRecoveryTimer: (providerId: string) => void
  declare private scheduleCredentialRecoveries: (document: RegistryDocument) => void
  declare private scheduleCredentialRecovery: (providerId: string, transaction: CredentialTransaction | undefined) => void
  declare private readDocumentForCredentialConsumer: (providerId: string) => Promise<RegistryDocument>
  declare private recoverExpiredCredentialTransactions: (document: RegistryDocument) => Promise<void>
  declare private recoverExpiredCredentialTransaction: (providerId: string, operationToken?: string) => Promise<boolean>
  declare private drainCredentialRefCleanup: () => Promise<void>
  declare private isProcessAlive: (pid: number) => boolean
  declare private retireStaleCredentialWrite: (reference: string) => Promise<void>
  declare private abandonCredentialWrite: (providerId: string, operationToken: string, reference: string) => Promise<void>
  declare private applyLatest: () => Promise<void>
  declare private project: (document: RegistryDocument) => ModelConnectionSnapshot
  declare private projectWithCredentialHealth: (document: RegistryDocument) => Promise<ModelConnectionSnapshot>
  declare private inspectCredentialHealth: (document: RegistryDocument) => Promise<ReadonlyMap<string, ProjectedCredentialHealth>>

  private readonly metadataRevisionFile: ReturnType<typeof modelCatalogRevisionFile>
  private readonly file: AtomicJsonFile<RegistryDocument>
  private readonly configurationImportSecrets = new Map<string, ProviderSecretBinding[]>()
  private readonly configurationPreviews = new Map<string, ConfigurationPreview>()
  private listeners = new Set<(snapshot: ModelConnectionSnapshot) => void>()
  private changeOperation: Promise<void> = Promise.resolve()
  private lastAppliedRevision = -1
  private credentialHealthRevision = -1
  private credentialHealth = new Map<string, ProjectedCredentialHealth>()
  /** Plaintext is origin-process memory only; the transaction authority is durable. */
  private preparedCredentialSecrets = new Map<string, PreparedCredentialSecret>()
  private preparedCredentialSecretTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private credentialRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly registryInstanceId = randomUUID()
  private readonly snapshotCache = new RegistrySnapshotCache()
  /** Set once the canonical v2 document is known to exist; see readDocumentForCredentialConsumer. */
  private legacyRegistryMigrated = false

  constructor(private readonly options: {
    dataDir: string
    credentials: ExtensionCredentialStore
    modelCapabilities?: (
      model: string,
      profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind' | 'endpointFormat' | 'endpoints'>
    ) => ModelCapabilityMetadata
    onChanged?: (connections: MaterializedModelConnections) => Promise<void> | void
    retireLegacyCredentialSource?: (sourceId: string) => Promise<void>
    inspectCredentialSource?: (sourceId: string) => Promise<ModelConnectionCredentialStatus>
    credentialFenceTtlMs?: number
    nowMs?: () => number
    isProcessAlive?: (pid: number) => boolean
    beforeCredentialFenceInstall?: (providerId: string) => Promise<void>
    afterCredentialCommitRecord?: (providerId: string) => Promise<void>
    afterCredentialCommitWrite?: (providerId: string) => Promise<void>
    afterCredentialConnectWrite?: (providerId: string) => Promise<void>
    historyReferenceSources?: () => Promise<Record<string, unknown>> | Record<string, unknown>
    referenceSources?: () => Promise<Record<string, unknown>> | Record<string, unknown>
    resolveCredentialSource?: (sourceId: string) => Promise<{
      apiKey: string
      headers?: Record<string, string>
    }>
  }) {
    this.metadataRevisionFile = modelCatalogRevisionFile(options.dataDir)
    const registryPath = join(options.dataDir, PROVIDER_REGISTRY_FILE)
    assertManagerAtomicJsonPath(registryPath)
    this.file = new AtomicJsonFile(
      registryPath,
      (value) => {
        const upgraded = upgradeProviderRegistry(upgradeRegistryProxyRouting(value))
        assertProviderConfigurationUrls(upgraded)
        return RegistryDocumentSchema.parse(upgraded)
      },
      false,
      // Every credential read, apply, and snapshot starts from this document.
      { cacheManagerReads: true }
    )
  }
}

export interface ModelConnectionRegistry extends ModelConnectionRegistryOperations {}

installServiceOperations(
  ModelConnectionRegistry.prototype,
  modelConnectionRegistryConnectionOperations,
  modelConnectionRegistryCredentialMutationOperations,
  modelConnectionRegistrySelectionOperations,
  modelConnectionRegistryMaterializationOperations,
  modelConnectionRegistryCredentialRecoveryOperations,
  providerConfigurationOperations,
  providerConfigurationSecretOperations
)


export type ProjectedCredentialHealth = {
  credentialStatus: ModelConnectionCredentialStatus
  credentialErrorCode?: ModelConnectionCredentialErrorCode
}

export function credentialHealth(status: ModelConnectionCredentialStatus): ProjectedCredentialHealth {
  if (status === 'missing') {
    return { credentialStatus: status, credentialErrorCode: 'credential_missing' }
  }
  if (status === 'unreadable') {
    return { credentialStatus: status, credentialErrorCode: 'credential_unreadable' }
  }
  return { credentialStatus: status }
}

export function readLatestIfChanged(
  registry: ModelConnectionRegistry,
  sinceRevision: number,
  finish: (snapshot: ModelConnectionSnapshot) => void,
  sinceMetadataRevision?: number
): void {
  // Compare revisions first; only a real change pays for a projection.
  void registry.revisionHead().then((head) => {
    if (head.revision <= sinceRevision &&
      (sinceMetadataRevision === undefined || head.metadataRevision <= sinceMetadataRevision)) return
    return registry.snapshot().then(finish)
  }).catch(() => undefined)
}

export function parseCredentialOperationToken(operationToken: string): {
  clientId: string
  generation: number
} {
  const [, clientId = '', generationRaw = ''] = operationToken.split(':')
  const generation = Number(generationRaw)
  if (!clientId || !Number.isSafeInteger(generation) || generation <= 0) {
    throw new Error('invalid credential operation token')
  }
  return { clientId, generation }
}

export function previousCredentialState(profile: StoredProfile): CredentialTransaction['previous'] {
  return {
    credentialRef: profile.credentialRef,
    credentialSourceId: profile.credentialSourceId,
    legacyCredentialSourceToRetire: profile.legacyCredentialSourceToRetire,
    configured: profile.configured
  }
}

export function boundedCredentialHighWater(
  current: StoredProfile['credentialMutationHighWater'],
  clientId: string,
  generation: number
): Record<string, number> {
  const previousClients = Object.entries(current ?? {})
    .filter(([existingClientId]) => existingClientId !== clientId)
    .slice(-63)
  return Object.fromEntries([...previousClients, [clientId, generation]])
}

export function appendCredentialRefs(
  current: RegistryDocument['credentialRefCleanup'],
  enqueuedAt: number,
  reference?: string,
  writerInstanceId?: string,
  writerPid?: number
): RegistryDocument['credentialRefCleanup'] {
  if (!reference) return current
  const existing = current[reference]
  if (existing && !existing.writerInstanceId) return current
  return {
    ...current,
    [reference]: {
      reference,
      enqueuedAt,
      ...(writerInstanceId ? { writerInstanceId } : {}),
      ...(writerPid ? { writerPid } : {})
    }
  }
}

export function requireCredentialTransaction(
  document: RegistryDocument,
  providerId: string,
  operationToken: string
): CredentialTransaction {
  const transaction = document.credentialTransactions[providerId]
  if (!transaction || transaction.operationToken !== operationToken) {
    throw new ModelConnectionConflictError(project(document))
  }
  return transaction
}

export function credentialReferenceIsLive(document: RegistryDocument, reference: string): boolean {
  return Object.values(document.profiles).some((profile) => profile.credentialRef === reference || profile.customHeadersRef === reference || profile.headersRef === reference) ||
    Object.values(document.credentialTransactions)
      .some((transaction) => transaction.nextCredentialRef === reference)
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function emptyDocument(): RegistryDocument {
  return {
    schemaVersion: 2,
    configuration: ProviderConfigurationStateSchema.parse({}),
    proxyRoutingVersion: 1,
    revision: 0,
    profiles: {},
    tombstones: {},
    credentialTransactions: {},
    credentialRefCleanup: {},
    proxy: { enabled: false, url: '' },
    routePools: [],
    failover: [],
    localModelGateway: { enabled: false, exposeProviderModels: false }
  }
}


export function reconcileSeedProfile(
  existing: StoredProfile,
  request: ModelConnectionConnectRequest
): StoredProfile {
  const incomingModels = uniqueModels([
    ...request.models,
    ...(request.selectedModel ? [request.selectedModel] : [])
  ])
  const seedIdentity = reconciledSeedIdentity(existing, request)
  const migrateTransport = seedIdentity.kind !== undefined
  // Once a profile exists, the Registry owns its catalog and selection.
  // AppSettings seeds are a compatibility import, not a union source: using
  // them to add models would resurrect a user-deleted model after restart.
  // The one exception is the explicit one-time Gemini transport migration.
  const models = migrateTransport && incomingModels.length > 0
    ? incomingModels
    : existing.models
  const selectedModel = migrateTransport
    ? request.selectedModel ?? models[0]
    : existing.selectedModel ?? models[0]
  const modelCapabilities = migrateTransport && request.modelCapabilities
    ? capabilitiesForModels(request.modelCapabilities, models)
    : existing.modelCapabilities

  const anonymousCredentiallessSeed = existing.authType === 'none' && request.kind === 'http' &&
    isAnonymousHttpProfile(request) &&
    !request.credential?.trim()

  return StoredProfileSchema.parse({
    ...existing,
    // Credential ownership is imported only when a profile is first created.
    // Re-applying GUI/settings seeds must never replace a Registry-owned
    // credentialRef, resurrect a cleared credential, or switch an existing
    // profile back to a legacy settings:provider:* source.
    ...seedIdentity,
    useProxy: request.useProxy ?? existing.useProxy,
    ...(anonymousCredentiallessSeed
      ? { configured: true }
      : migrateTransport
        ? {
            baseUrl: request.baseUrl,
            endpointFormat: request.endpointFormat,
            ...(request.endpoints ? { endpoints: request.endpoints } : {}),
            configured: true
          }
        : {}),
    models,
    ...(modelCapabilities ? { modelCapabilities } : {}),
    ...(selectedModel ? { selectedModel } : {})
  })
}

export function sameStoredProfile(left: StoredProfile, right: StoredProfile): boolean {
  return left.id === right.id &&
    left.accountId === right.accountId &&
    left.name === right.name &&
    left.presetSource === right.presetSource &&
    left.presetMode === right.presetMode &&
    left.kind === right.kind &&
    left.authType === right.authType &&
    left.baseUrl === right.baseUrl &&
    left.endpointFormat === right.endpointFormat &&
    sameEndpoints(left.endpoints, right.endpoints) &&
    left.useProxy === right.useProxy &&
    left.configured === right.configured &&
    left.incarnationId === right.incarnationId &&
    left.selectedModel === right.selectedModel &&
    left.headersRef === right.headersRef &&
    left.credentialRef === right.credentialRef &&
    left.credentialSourceId === right.credentialSourceId &&
    left.legacyCredentialSourceToRetire === right.legacyCredentialSourceToRetire &&
    sameHeaders(left.customHeaders, right.customHeaders) &&
    sameModels(left.models, right.models) &&
    sameCapabilities(left.modelCapabilities, right.modelCapabilities)
}

export function project(
  document: RegistryDocument,
  resolveModelCapabilities?: (
    model: string,
    profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind' | 'endpointFormat' | 'endpoints'>
  ) => ModelCapabilityMetadata,
  credentialHealthByProvider: ReadonlyMap<string, ProjectedCredentialHealth> = new Map()
): ModelConnectionSnapshot {
  const providers = Object.values(document.profiles)
    .map((rawProfile) => {
      const resolved = effectiveProviderConfiguration(rawProfile, document.configuration)
      const storedProfile = resolved.profile
      const {
        incarnationId: _incarnationId,
        credentialMutationHighWater: _credentialMutationHighWater,
        credentialRef: _credentialRef,
        credentialSourceId: _credentialSourceId,
        legacyCredentialSourceToRetire: _legacyCredentialSourceToRetire,
        headers: _headers,
        headersRef: _headersRef,
        customHeaders: customHeaders,
        customHeadersRef: _customHeadersRef,
        customHeaderNames,
        ...profile
      } = storedProfile
      const credentialHealth = credentialHealthByProvider.get(profile.id)
      const modelCapabilities = Object.fromEntries(profile.models.flatMap((model) => {
        const stored = profile.modelCapabilities?.[model] ??
          profile.modelCapabilities?.[model.trim().toLowerCase()]
        const derived = resolveModelCapabilities?.(model, profile)
        const capability = mergeProjectedCapability(stored, derived, profile, model)
        return capability ? [[model, { ...capability, id: model }]] : []
      }))
      return {
        ...profile,
        configured: isProfileUsable(storedProfile, credentialHealth),
        ...(!resolved.enabled ? { enabled: false } : {}),
        ...credentialHealth,
        ...(Object.keys(modelCapabilities).length > 0 ? { modelCapabilities } : {}),
        ...((customHeaderNames?.length || (customHeaders && Object.keys(customHeaders).length > 0))
          ? { customHeaderNames: customHeaderNames ?? Object.keys(customHeaders ?? {}) }
          : {})
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const selected = document.defaultProviderId
    ? providers.find((profile) => profile.id === document.defaultProviderId && profile.configured && profile.enabled !== false)
    : undefined
  return ModelConnectionSnapshotSchema.parse({
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision: document.revision,
    providers,
    ...(selected
      ? {
          defaultProviderId: document.defaultProviderId,
          defaultAccountId: document.defaultAccountId,
          defaultModel: document.defaultModel
        }
      : {}),
    proxy: document.proxy,
    routePools: document.routePools,
    failover: document.failover,
    localModelGateway: document.localModelGateway
  })
}

export function mergeProjectedCapability(
  stored: ModelCapabilityMetadata | undefined,
  derived: ModelCapabilityMetadata | undefined,
  profile: Pick<ModelConnectionProfile, 'id' | 'endpointFormat'> & { presetSource?: string },
  model: string
): ModelCapabilityMetadata | undefined {
  if (!stored) return enforceProviderModelSafety(normalizeModelCapabilityMetadata(derived), profile)
  const value = derived ? withModelObservation(stored, {
    id: 'runtime-adapter', source: 'adapter', values: derived,
    evidence: derived.evidence ?? metadataEvidence(derived, 'adapter'), match: 'exact'
  }) : stored
  return enforceProviderModelSafety(normalizeModelCapabilityMetadata({ ...resolveModelMetadata(value), id: model }), profile)
}

export function assertRevision(
  document: RegistryDocument,
  expected: number,
  resolveModelCapabilities?: (
    model: string,
    profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind' | 'endpointFormat' | 'endpoints'>
  ) => ModelCapabilityMetadata,
  credentialHealthByProvider: ReadonlyMap<string, ProjectedCredentialHealth> = new Map()
): void {
  if (document.revision !== expected) {
    throw new ModelConnectionConflictError(project(
      document,
      resolveModelCapabilities,
      credentialHealthByProvider
    ))
  }
}

export function requireProfile(document: RegistryDocument, providerId: string): StoredProfile {
  const profile = document.profiles[providerId]
  if (!profile) throw new Error('model connection not found')
  return profile
}

export function capabilitiesForModels(
  input: Record<string, ModelCapabilityMetadata>,
  models: readonly string[]
): Record<string, ModelCapabilityMetadata> {
  return Object.fromEntries(models.flatMap((model) => {
    const capability = input[model] ?? input[model.trim().toLowerCase()]
    const normalized = capability
      ? normalizeModelCapabilityMetadata(migrateModelMetadata({ ...capability, id: model }))
      : undefined
    return normalized ? [[model, normalized]] : []
  }))
}

export function sameCapabilities(
  left: Record<string, ModelCapabilityMetadata> | undefined,
  right: Record<string, ModelCapabilityMetadata> | undefined
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

export function allocateId(document: RegistryDocument, requested: string): string {
  const base = normalizeProviderId(requested) || 'provider'
  if (!document.profiles[base] && !document.credentialTransactions[base]) return base
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}-${index}`
    if (!document.profiles[candidate] && !document.credentialTransactions[candidate]) return candidate
  }
  throw new Error('unable to allocate provider id')
}

export function normalizeProviderId(requested: string): string {
  return requested.trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100)
}

export function preparedCredentialSecretTimerKey(providerId: string, operationToken: string): string {
  return `${providerId}\u0000${operationToken}`
}

export function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))]
}

export function sameModels(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index])
}

export function sameHeaders(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

export function sameEndpoints(
  left: StoredProfile['endpoints'],
  right: StoredProfile['endpoints']
): boolean {
  return (left?.chat_completions ?? '') === (right?.chat_completions ?? '') &&
    (left?.responses ?? '') === (right?.responses ?? '') &&
    (left?.messages ?? '') === (right?.messages ?? '')
}
