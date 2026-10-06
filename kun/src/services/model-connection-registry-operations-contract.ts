import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { assertManagerAtomicJsonPath, AtomicJsonFile } from '../extensions/atomic-json.js'
import type { ServeProviderConfig } from '../config/kun-config.js'
import type { ModelCapabilityMetadata } from '../contracts/capabilities.js'
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
import type { StoredProfileSchema, DeletedProfileTombstoneSchema, CredentialTransactionPreviousSchema, CredentialTransactionSchema, CredentialRefCleanupEntrySchema, RegistryDocumentSchema, RegistryDocument, StoredProfile, CredentialTransaction, PreparedCredentialSecret, ModelConnectionSeed, AuthenticatedModelConnectionInput, MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX, isModelConnectionCredentialSourceId, modelConnectionCredentialSourceId, providerIdFromCredentialSource, ModelConnectionConflictError, MaterializedModelConnections, ProjectedCredentialHealth, credentialHealth, readLatestIfChanged, parseCredentialOperationToken, previousCredentialState, boundedCredentialHighWater, appendCredentialRefs, requireCredentialTransaction, credentialReferenceIsLive, processIsAlive, emptyDocument, configuredFallback, reconcileSeedProfile, sameStoredProfile, project, isProfileUsable, mergeProjectedCapability, assertRevision, requireProfile, capabilitiesForModels, sameCapabilities, allocateId, normalizeProviderId, preparedCredentialSecretTimerKey, uniqueModels, sameModels, probeModels, modelsUrl } from './model-connection-registry-core.js'

export interface ModelConnectionRegistryOperations {
  gatewayClientPolicy(clientId: string): Promise<{ revision: number; policy?: import('../contracts/gateway-client-policy.js').GatewayClientPolicy }>;
  configurationSnapshot(): Promise<{
    schemaVersion: 2; revision: number; activeRevision: number; defaultProviderId?: string; defaultAccountId?: string; defaultModel?: string;
    configuration: Omit<import('../contracts/provider-configuration.js').ProviderConfigurationState, 'commits'>;
    connections: ModelConnectionProfile[]; routePools: RegistryDocument['routePools'];
    failover: RegistryDocument['failover']; localModelGateway: RegistryDocument['localModelGateway'];
    fieldSources: Record<string, Record<string, 'connection' | 'group' | 'template'>>;
  }>;
  previewConfiguration(raw: unknown): Promise<import('./provider-configuration-operations.js').ConfigurationPreview>;
  previewProviderRecovery(): Promise<ReturnType<typeof import('./provider-registry-recovery.js').previewProviderRegistryDowngrade>>;
  exportProviderRecovery(expectedRevision: number): Promise<ReturnType<typeof import('./provider-registry-recovery.js').exportProviderRegistryDowngrade>>;
  previewProviderImport(raw: unknown): Promise<import('./provider-configuration-operations.js').ConfigurationPreview & { remaps: Record<string, Record<string, string>>; secretSlots: Array<{ id: string; connectionId: string; kind: 'credential' | 'headers'; names?: string[]; bound: boolean }> }>;
  exportProviderBackup(password: unknown): Promise<{ backup: import('./provider-configuration-backup.js').ProviderEncryptedBackup; missingSlots: string[] }>;
  previewProviderBackup(raw: unknown): ReturnType<ModelConnectionRegistryOperations['previewProviderImport']>;
  commitProviderImport(raw: unknown): ReturnType<ModelConnectionRegistryOperations['commitConfiguration']>;
  commitConfiguration(raw: unknown, bindings?: import('./provider-configuration-secret-operations.js').PreparedImportBinding[]): Promise<{ committedRevision: number; applied: boolean;
    snapshot: Awaited<ReturnType<ModelConnectionRegistryOperations['configurationSnapshot']>> }>;
  initialize(
    seed?: readonly ModelConnectionSeed[] ,
    globals?: {
      proxy?: RegistryDocument['proxy']
      routePools?: RegistryDocument['routePools']
      failover?: RegistryDocument['failover']
      localModelGateway?: RegistryDocument['localModelGateway']
    }
  ): Promise<ModelConnectionSnapshot>;
  snapshot(): Promise<ModelConnectionSnapshot>;
  getCustomHeaders(providerId: string): Promise<Record<string, string>>;
  assertRevision(expectedRevision: number): Promise<void>;
  subscribe(listener: (snapshot: ModelConnectionSnapshot) => void): () => void;
  waitForRevision(
    sinceRevision: number,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<ModelConnectionSnapshot>;
  connect(raw: unknown): Promise<ModelConnectionSnapshot>;
  connectAuthenticated(
    raw: AuthenticatedModelConnectionInput
  ): Promise<ModelConnectionSnapshot>;
  patch(providerId: string, raw: unknown): Promise<ModelConnectionSnapshot>;
  fenceCredential(providerId: string, raw: unknown): Promise<ModelConnectionSnapshot>;
  prepareCredential(providerId: string, raw: unknown): Promise<ModelConnectionSnapshot>;
  commitPreparedCredential(providerId: string, raw: unknown): Promise<ModelConnectionSnapshot>;
  replaceCredential(providerId: string, raw: unknown): Promise<ModelConnectionSnapshot>;
  clearCredential(
    providerId: string,
    expectedRevision: number
  ): Promise<ModelConnectionSnapshot>;
  delete(providerId: string, expectedRevision: number): Promise<ModelConnectionSnapshot>;
  select(raw: unknown): Promise<ModelConnectionSnapshot>;
  synchronizeDefaultSelection(raw: {
    providerId: string
    accountId?: string
    model: string
  }): Promise<ModelConnectionSnapshot>;
  updateGlobals(raw: unknown): Promise<ModelConnectionSnapshot>;
  probe(providerId: string, signal?: AbortSignal): Promise<{ ok: true; models: string[] }>;
  /**
   * Last persisted model-list fetch for the provider
   * (`model-catalog/providers/<id>.json`), or null when never fetched.
   */
  catalog(providerId: string): Promise<import('./model-catalog-store.js').ModelCatalogEntry | null>;
  credentialForCompatibility(providerId: string): Promise<string | null>;
  credentialFingerprints(): Promise<Record<string, string>>;
  credentialStateForInternalConsumer(providerId: string): Promise<{
    authoritative: boolean
    apiKey: string
  }>;
  resolveApiKey(sourceId: string): Promise<{ apiKey: string } | null>;
  updateResolvedApiKey(
    sourceId: string,
    expectedApiKey: string,
    apiKey: string
  ): Promise<boolean>;
  materialize(): Promise<MaterializedModelConnections>;
  materializeReadOnly(): Promise<MaterializedModelConnections>;
}
