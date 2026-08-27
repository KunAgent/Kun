import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import type { ServeProviderConfig } from '../config/kun-config.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
import { normalizeModelCapabilityMetadata } from './model-capability-limits.js'
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
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { installServiceOperations } from './service-operation-install.js'
import { modelConnectionRegistryConnectionOperations } from './model-connection-registry-connection-operations.js'
import { modelConnectionRegistryCredentialMutationOperations } from './model-connection-registry-credential-mutation-operations.js'
import { modelConnectionRegistrySelectionOperations } from './model-connection-registry-selection-operations.js'
import { modelConnectionRegistryMaterializationOperations } from './model-connection-registry-materialization-operations.js'
import { modelConnectionRegistryCredentialRecoveryOperations } from './model-connection-registry-credential-recovery-operations.js'
import { reconciledSeedIdentity } from './model-connection-registry-seed-support.js'
import type { ModelConnectionRegistryOperations } from './model-connection-registry-operations-contract.js'
import { isAnonymousHttpProfile, isProfileUsable } from './model-connection-registry-usability.js'
export { configuredFallback, isAnonymousHttpProfile, isProfileUsable } from './model-connection-registry-usability.js'

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
  headers: z.record(z.string(), z.string()).optional()
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
  schemaVersion: z.literal(1),
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

export type ModelConnectionSeed = ModelConnectionConnectRequest & {
  /** Trusted runtime-only binding; never accepted by public connection APIs. */
  credentialSourceId?: string
}

export type AuthenticatedModelConnectionInput = Omit<
  ModelConnectionConnectRequest,
  'credential' | 'probe'
> & {
  /**
   * Credential material produced by a runtime-owned OAuth/SDK flow. Official
   * CLI providers omit this only after the service has verified their
   * provider-owned login.
   */
  credential?: string
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
  selected?: { profile: StoredProfile; config: ServeProviderConfig; model: string }
  providers: Map<string, ServeProviderConfig>
  proxy: RegistryDocument['proxy']
  routePools: RegistryDocument['routePools']
  localModelGateway: RegistryDocument['localModelGateway']
}

export class ModelConnectionRegistry {
  declare private connectInternal: (raw: unknown, credentialSourceId?: string, trustedExternalAuth?: boolean) => Promise<ModelConnectionSnapshot>
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

  private readonly file: AtomicJsonFile<RegistryDocument>
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

  constructor(private readonly options: {
    dataDir: string
    credentials: ExtensionCredentialStore
    modelCapabilities?: (
      model: string,
      profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind'>
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
    resolveCredentialSource?: (sourceId: string) => Promise<{
      apiKey: string
      headers?: Record<string, string>
    }>
  }) {
    const registryPath = join(options.dataDir, 'model-connections.v1.json')
    assertManagerAtomicJsonPath(registryPath)
    this.file = new AtomicJsonFile(
      registryPath,
      (value) => RegistryDocumentSchema.parse(value),
      false
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
  modelConnectionRegistryCredentialRecoveryOperations
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
  finish: (snapshot: ModelConnectionSnapshot) => void
): void {
  void registry.snapshot().then((snapshot) => {
    if (snapshot.revision > sinceRevision) finish(snapshot)
  })
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
  return Object.values(document.profiles).some((profile) => profile.credentialRef === reference) ||
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
    schemaVersion: 1,
    revision: 0,
    profiles: {},
    tombstones: {},
    credentialTransactions: {},
    credentialRefCleanup: {},
    proxy: { enabled: false, url: '' },
    routePools: [],
    localModelGateway: { enabled: false }
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

  const anonymousCredentiallessSeed = request.kind === 'http' &&
    isAnonymousHttpProfile(request) &&
    !request.credential?.trim()
  const profileBase = anonymousCredentiallessSeed
    ? (() => {
        const {
          credentialRef: _credentialRef,
          credentialSourceId: _credentialSourceId,
          legacyCredentialSourceToRetire: _legacyCredentialSourceToRetire,
          ...withoutCredential
        } = existing
        return withoutCredential
      })()
    : existing

  return StoredProfileSchema.parse({
    ...profileBase,
    // Credential ownership is imported only when a profile is first created.
    // Re-applying GUI/settings seeds must never replace a Registry-owned
    // credentialRef, resurrect a cleared credential, or switch an existing
    // profile back to a legacy settings:provider:* source.
    ...seedIdentity,
    ...(anonymousCredentiallessSeed
      ? { configured: true }
      : migrateTransport
        ? {
            baseUrl: request.baseUrl,
            endpointFormat: request.endpointFormat,
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
    left.configured === right.configured &&
    left.incarnationId === right.incarnationId &&
    left.selectedModel === right.selectedModel &&
    left.credentialRef === right.credentialRef &&
    left.credentialSourceId === right.credentialSourceId &&
    left.legacyCredentialSourceToRetire === right.legacyCredentialSourceToRetire &&
    sameModels(left.models, right.models) &&
    sameCapabilities(left.modelCapabilities, right.modelCapabilities)
}

export function project(
  document: RegistryDocument,
  resolveModelCapabilities?: (
    model: string,
    profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind'>
  ) => ModelCapabilityMetadata,
  credentialHealthByProvider: ReadonlyMap<string, ProjectedCredentialHealth> = new Map()
): ModelConnectionSnapshot {
  const providers = Object.values(document.profiles)
    .map((storedProfile) => {
      const {
        incarnationId: _incarnationId,
        credentialMutationHighWater: _credentialMutationHighWater,
        credentialRef: _credentialRef,
        credentialSourceId: _credentialSourceId,
        legacyCredentialSourceToRetire: _legacyCredentialSourceToRetire,
        headers: _headers,
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
        ...credentialHealth,
        ...(Object.keys(modelCapabilities).length > 0 ? { modelCapabilities } : {})
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const selected = document.defaultProviderId
    ? providers.find((profile) => profile.id === document.defaultProviderId && profile.configured)
    : undefined
  return ModelConnectionSnapshotSchema.parse({
    schemaVersion: 1,
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
    localModelGateway: document.localModelGateway
  })
}


export function mergeProjectedCapability(
  stored: ModelCapabilityMetadata | undefined,
  derived: ModelCapabilityMetadata | undefined,
  profile: Pick<ModelConnectionProfile, 'id' | 'endpointFormat'>,
  model: string
): ModelCapabilityMetadata | undefined {
  if (!stored) return normalizeModelCapabilityMetadata(derived)
  const serviceTiers = stored.serviceTiers ?? derived?.serviceTiers
  if (!derived?.reasoning || stored.reasoning === derived.reasoning) {
    return normalizeModelCapabilityMetadata(
      serviceTiers ? { ...stored, serviceTiers: [...serviceTiers] } : stored
    )
  }
  const placeholder = stored.reasoning?.requestProtocol === 'none' &&
    derived.reasoning.requestProtocol !== 'none' &&
    stored.reasoning.defaultEffort === 'auto' &&
    stored.reasoning.supportedEfforts.every((effort) => effort === 'auto' || effort === 'off')
  const chatResponsesMismatch =
    profile.endpointFormat === 'chat_completions' &&
    stored.reasoning?.requestProtocol === 'openai-responses' &&
    derived.reasoning.requestProtocol === 'openai-chat-completions' &&
    (
      (profile.id.toLowerCase().includes('kimi-code') && model.trim().toLowerCase() === 'k3') ||
      (profile.id.toLowerCase().includes('opencode-go') &&
        model.trim().toLowerCase().endsWith('grok-4.5'))
    )
  if (!stored.reasoning || placeholder || chatResponsesMismatch) {
    return normalizeModelCapabilityMetadata({
      ...stored,
      reasoning: derived.reasoning,
      ...(serviceTiers ? { serviceTiers: [...serviceTiers] } : {})
    })
  }
  return normalizeModelCapabilityMetadata(
    serviceTiers ? { ...stored, serviceTiers: [...serviceTiers] } : stored
  )
}

export function assertRevision(
  document: RegistryDocument,
  expected: number,
  resolveModelCapabilities?: (
    model: string,
    profile?: Pick<ModelConnectionProfile, 'id' | 'presetSource' | 'baseUrl' | 'kind'>
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
      ? normalizeModelCapabilityMetadata({ ...capability, id: model })
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

export async function probeModels(input: {
  kind: ModelConnectionProfile['kind']
  baseUrl?: string
  endpointFormat?: ModelConnectionProfile['endpointFormat']
  apiKey: string
  headers?: Record<string, string>
  fallbackModels: readonly string[]
  proxyUrl: string
}): Promise<string[]> {
  if (input.kind !== 'http') return uniqueModels(input.fallbackModels)
  if (!input.baseUrl) throw new Error('provider probe failed: HTTP provider has no base URL')
  // Custom full inference endpoints have no discoverable /models URL. When the
  // profile already lists models (Codex, coding-plan gateways, user custom
  // paths), treat an explicit credential + catalog as a successful probe.
  if (input.endpointFormat === 'custom_endpoint') {
    const configured = uniqueModels(input.fallbackModels)
    if (configured.length === 0) {
      throw new Error(
        'provider probe failed: custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
      )
    }
    if (!input.apiKey.trim()) {
      throw new Error('provider probe failed: custom_endpoint requires a credential when probing configured models')
    }
    return configured
  }
  const url = modelsUrl(input.baseUrl, input.endpointFormat)
  const usesAnthropicHeaders = input.endpointFormat === 'messages'
  const authHeaders: Record<string, string> = input.apiKey
    ? usesAnthropicHeaders
      ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' }
      : { authorization: `Bearer ${input.apiKey}` }
    : {}
  const fetchImpl = createProxyFetch(input.proxyUrl) ?? fetch
  const response = await fetchImpl(url, {
    headers: { ...(input.headers ?? {}), ...authHeaders },
    signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`provider probe failed with HTTP ${response.status}`)
  const value = await response.json().catch(() => ({})) as { data?: Array<{ id?: unknown }>; models?: unknown[] }
  const discovered = Array.isArray(value.data)
    ? value.data.flatMap((entry) => typeof entry?.id === 'string' ? [entry.id] : [])
    : Array.isArray(value.models)
      ? value.models.flatMap((entry) => typeof entry === 'string' ? [entry] : [])
      : []
  return uniqueModels([...discovered, ...input.fallbackModels])
}

export function modelsUrl(
  baseUrl: string,
  endpointFormat: ModelConnectionProfile['endpointFormat'] | undefined
): string {
  if (endpointFormat === 'custom_endpoint') {
    throw new Error(
      'provider probe failed: custom_endpoint does not define a models URL; configure models explicitly with probe disabled'
    )
  }
  const url = new URL(baseUrl)
  url.search = ''
  url.hash = ''
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments.at(-1)?.toLowerCase()
  if (last === 'models') {
    url.pathname = `/${segments.join('/')}`
    return url.toString()
  }
  if (last === 'responses' || last === 'messages') {
    segments.pop()
  } else if (last === 'completions' && segments.at(-2)?.toLowerCase() === 'chat') {
    segments.splice(-2)
  }
  const version = segments.at(-1)?.toLowerCase()
  if (version === 'beta') {
    segments[segments.length - 1] = 'v1'
  } else if (!version || !/^v\d+$/u.test(version)) {
    segments.push('v1')
  }
  if (segments.at(-1)?.toLowerCase() !== 'models') segments.push('models')
  url.pathname = `/${segments.join('/')}`
  return url.toString()
}
