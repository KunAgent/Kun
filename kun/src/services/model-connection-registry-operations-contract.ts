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
  initialize(
    seed?: readonly ModelConnectionSeed[] ,
    globals?: {
      proxy?: RegistryDocument['proxy']
      routePools?: RegistryDocument['routePools']
      localModelGateway?: RegistryDocument['localModelGateway']
    }
  ): Promise<ModelConnectionSnapshot>;
  snapshot(): Promise<ModelConnectionSnapshot>;
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
  probe(providerId: string): Promise<{ ok: true; models: string[] }>;
  credentialForCompatibility(providerId: string): Promise<string | null>;
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
