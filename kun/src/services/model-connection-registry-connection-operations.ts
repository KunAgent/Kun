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
import { type ModelConnectionRegistry, StoredProfileSchema, DeletedProfileTombstoneSchema, CredentialTransactionPreviousSchema, CredentialTransactionSchema, CredentialRefCleanupEntrySchema, RegistryDocumentSchema, type RegistryDocument, type StoredProfile, type CredentialTransaction, type PreparedCredentialSecret, type ModelConnectionSeed, type AuthenticatedModelConnectionInput, MODEL_CONNECTION_CREDENTIAL_SOURCE_PREFIX, isModelConnectionCredentialSourceId, modelConnectionCredentialSourceId, providerIdFromCredentialSource, ModelConnectionConflictError, type MaterializedModelConnections, type ProjectedCredentialHealth, credentialHealth, readLatestIfChanged, parseCredentialOperationToken, previousCredentialState, boundedCredentialHighWater, appendCredentialRefs, requireCredentialTransaction, credentialReferenceIsLive, processIsAlive, emptyDocument, configuredFallback, reconcileSeedProfile, sameStoredProfile, project, isProfileUsable, isAnonymousHttpProfile, mergeProjectedCapability, assertRevision, requireProfile, capabilitiesForModels, sameCapabilities, allocateId, normalizeProviderId, preparedCredentialSecretTimerKey, uniqueModels, sameModels, probeModels, modelsUrl } from './model-connection-registry-core.js'
import { repairRegistryModelCapabilityLimits } from './model-capability-limits.js'

export const modelConnectionRegistryConnectionOperations = {
async initialize(this: ModelConnectionRegistry,
    seed: readonly ModelConnectionSeed[] = [],
    globals?: {
      proxy?: RegistryDocument['proxy']
      routePools?: RegistryDocument['routePools']
      localModelGateway?: RegistryDocument['localModelGateway']
    }
  ): Promise<ModelConnectionSnapshot> {
    let current = await this['file'].read(emptyDocument)
    if (repairRegistryModelCapabilityLimits(current)) {
      current = await this['file'].update(emptyDocument, (document) => {
        const repaired = repairRegistryModelCapabilityLimits(document)
        return repaired ? { ...repaired, revision: document.revision + 1 } : document
      })
    }
    await this['recoverExpiredCredentialTransactions'](current)
    await this['drainCredentialRefCleanup']()
    current = await this['file'].read(emptyDocument)
    const newRegistry = Object.keys(current.profiles).length === 0 &&
      Object.keys(current.tombstones).length === 0
    if (seed.length > 0) {
      for (const input of seed) {
        const credentialSourceId = input.credentialSourceId?.trim() || undefined
        const { credentialSourceId: _credentialSourceId, ...publicInput } = input
        const request = ModelConnectionConnectRequestSchema.parse({
          ...publicInput,
          expectedRevision: current.revision,
          probe: false
        })
        const existing = request.id ? current.profiles[request.id] : undefined
        if (!existing) {
          const requestedId = normalizeProviderId(request.id ?? request.name)
          if (current.tombstones[requestedId]) {
            // Durable deletion intent is authoritative over stale AppSettings
            // seeds across GUI/Runtime restarts. Only an explicit connect API
            // may clear this tombstone and re-add the same id.
            continue
          }
          // A non-empty registry is authoritative for the current default, but
          // GUI-managed providers that were never imported must still become
          // visible to standalone TUI clients.
          await this['connectInternal'](
            { ...request, select: newRegistry ? request.select : false },
            credentialSourceId,
            request.kind === 'antigravity-cli' || request.kind === 'gemini-cli-api'
          )
        } else {
          const reconciled = reconcileSeedProfile(existing, request)
          if (!sameStoredProfile(existing, reconciled)) {
            current = await this['file'].update(emptyDocument, (document) => {
              assertRevision(
                document,
                current.revision,
                this['options'].modelCapabilities,
                this['credentialHealth']
              )
              const profile = requireProfile(document, existing.id)
              const nextProfile = reconcileSeedProfile(profile, request)
              const retiredCredentialRef = profile.credentialRef !== nextProfile.credentialRef
                ? profile.credentialRef
                : undefined
              return {
                ...document,
                revision: document.revision + 1,
                profiles: {
                  ...document.profiles,
                  [existing.id]: nextProfile
                },
                credentialRefCleanup: appendCredentialRefs(
                  document.credentialRefCleanup,
                  this['nowMs'](),
                  retiredCredentialRef,
                  this['registryInstanceId'],
                  process.pid
                ),
                ...(document.defaultProviderId === existing.id && nextProfile.selectedModel
                  ? { defaultModel: nextProfile.selectedModel }
                  : {})
              }
            })
            await this['changed'](current)
            await this['drainCredentialRefCleanup']()
          }
          current = await this['file'].read(emptyDocument)
          if (!current.profiles[existing.id]?.configured && request.credential?.trim()) {
            await this.replaceCredential(existing.id, {
              expectedRevision: current.revision,
              credential: request.credential
            })
          }
        }
        current = await this['file'].read(emptyDocument)
      }
    }
    current = await this['file'].read(emptyDocument)
    if (repairRegistryModelCapabilityLimits(current)) {
      current = await this['file'].update(emptyDocument, (document) => {
        const repaired = repairRegistryModelCapabilityLimits(document)
        return repaired ? { ...repaired, revision: document.revision + 1 } : document
      })
      await this['changed'](current)
    }
    if (globals) {
      const nextProxy = globals.proxy ?? current.proxy
      const nextRoutePools = globals.routePools ?? current.routePools
      const nextLocalModelGateway = globals.localModelGateway ?? current.localModelGateway
      if (JSON.stringify({
        proxy: current.proxy,
        routePools: current.routePools,
        localModelGateway: current.localModelGateway
      }) !== JSON.stringify({
        proxy: nextProxy,
        routePools: nextRoutePools,
        localModelGateway: nextLocalModelGateway
      })) {
        current = await this['file'].update(emptyDocument, (document) => {
          const proxy = globals.proxy ?? document.proxy
          const routePools = globals.routePools ?? document.routePools
          const localModelGateway = globals.localModelGateway ?? document.localModelGateway
          if (JSON.stringify({ proxy: document.proxy, routePools: document.routePools, localModelGateway: document.localModelGateway }) ===
            JSON.stringify({ proxy, routePools, localModelGateway })) return document
          return {
            ...document,
            revision: document.revision + 1,
            proxy,
            routePools,
            localModelGateway
          }
        })
      }
    }
    await this['retryLegacyCredentialSourceRetirements']()
    await this['applyLatest']()
    this['scheduleCredentialRecoveries'](await this['file'].read(emptyDocument))
    return this.snapshot()
  },

async snapshot(this: ModelConnectionRegistry): Promise<ModelConnectionSnapshot> {
    return this['projectWithCredentialHealth'](await this['file'].read(emptyDocument))
  },

async assertRevision(this: ModelConnectionRegistry, expectedRevision: number): Promise<void> {
    assertRevision(
      await this['file'].read(emptyDocument),
      expectedRevision,
      this['options'].modelCapabilities,
      this['credentialHealth']
    )
  },

subscribe(this: ModelConnectionRegistry, listener: (snapshot: ModelConnectionSnapshot) => void): () => void {
    this['listeners'].add(listener)
    return () => this['listeners'].delete(listener)
  },

async waitForRevision(this: ModelConnectionRegistry,
    sinceRevision: number,
    signal: AbortSignal,
    timeoutMs: number
  ): Promise<ModelConnectionSnapshot> {
    const initial = await this.snapshot()
    if (initial.revision > sinceRevision || signal.aborted || timeoutMs <= 0) return initial
    return new Promise((resolve) => {
      let settled = false
      let unsubscribe: (() => void) | undefined
      const finish = (snapshot: ModelConnectionSnapshot): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        unsubscribe?.()
        resolve(snapshot)
      }
      const readLatest = (): void => { void this.snapshot().then(finish, () => finish(initial)) }
      const aborted = (): void => readLatest()
      const timer = setTimeout(readLatest, timeoutMs)
      timer.unref?.()
      unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.revision > sinceRevision) finish(snapshot)
      })
      signal.addEventListener('abort', aborted, { once: true })
      // Close the read/subscribe race if a writer committed between them.
      readLatestIfChanged(this, sinceRevision, finish)
    })
  },

async connect(this: ModelConnectionRegistry, raw: unknown): Promise<ModelConnectionSnapshot> {
    return this['connectInternal'](raw)
  },

/**
   * Runtime-only authenticated upsert used after OAuth, SDK, or official CLI
   * verification. Unlike public connect(), a stable preset id is updated in
   * place so reconnecting never allocates a duplicate `-2` profile.
   */
async connectAuthenticated(this: ModelConnectionRegistry,
    raw: AuthenticatedModelConnectionInput
  ): Promise<ModelConnectionSnapshot> {
    const {
      externalAuthVerified = false,
      ...connection
    } = raw
    const input = ModelConnectionConnectRequestSchema.parse({
      ...connection,
      probe: false
    })
    const requestedId = input.id?.trim()
    if (!requestedId) throw new Error('authenticated model connection id is required')
    const connectedId = normalizeProviderId(requestedId)
    if (input.kind === 'http' && !input.baseUrl) {
      throw new Error('baseUrl is required for HTTP providers')
    }
    const credential = input.credential?.trim() ?? ''
    if (!credential && !externalAuthVerified) {
      throw new Error('authenticated model connection credential is required')
    }
    const profileFor = (
      current: RegistryDocument,
      credentialRef: string | undefined,
      incarnationId: string
    ): StoredProfile => {
      const existing = current.profiles[connectedId]
      const deleted = current.tombstones[connectedId]
      const models = uniqueModels(input.models)
      const selectedModel = input.selectedModel ?? models[0]
      if (selectedModel && models.length > 0 && !models.includes(selectedModel)) {
        throw new Error('selected model is not present in the provider model list')
      }
      const legacyCredentialSourceToRetire = this['options'].retireLegacyCredentialSource
        ? existing?.legacyCredentialSourceToRetire ??
          existing?.credentialSourceId ??
          deleted?.legacyCredentialSourceToRetire
        : undefined
      return StoredProfileSchema.parse({
        id: connectedId,
        accountId: existing?.accountId ?? `account:${connectedId}`,
        name: input.name,
        presetSource: input.presetSource,
        ...(input.presetMode ? { presetMode: input.presetMode } : {}),
        kind: input.kind,
        authType: input.authType,
        baseUrl: input.baseUrl,
        endpointFormat: input.endpointFormat,
        configured: true,
        incarnationId,
        credentialMutationHighWater:
          existing?.credentialMutationHighWater ?? deleted?.credentialMutationHighWater,
        models,
        ...(input.modelCapabilities
          ? { modelCapabilities: capabilitiesForModels(input.modelCapabilities, models) }
          : {}),
        selectedModel,
        credentialRef,
        credentialSourceId: credentialRef ? undefined : existing?.credentialSourceId,
        ...(legacyCredentialSourceToRetire ? { legacyCredentialSourceToRetire } : {}),
        headers: existing?.headers
      })
    }

    if (!credential) {
      const document = await this['file'].update(emptyDocument, (current) => {
        assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
        if (current.credentialTransactions[connectedId]) {
          throw new ModelConnectionConflictError(this['project'](current))
        }
        const existing = current.profiles[connectedId]
        const profile = profileFor(
          current,
          existing?.credentialRef,
          existing?.incarnationId ?? randomUUID()
        )
        const tombstones = { ...current.tombstones }
        delete tombstones[connectedId]
        return {
          ...current,
          revision: current.revision + 1,
          profiles: { ...current.profiles, [connectedId]: profile },
          tombstones,
          ...(input.select && profile.selectedModel ? {
            defaultProviderId: connectedId,
            defaultAccountId: profile.accountId,
            defaultModel: profile.selectedModel
          } : {})
        }
      })
      await this['changed'](document)
      await this['retireLegacyCredentialSource'](connectedId)
      return this['projectWithCredentialHealth'](document)
    }

    const operationToken = `authenticated:${randomUUID()}`
    const nextRef = `cred_${randomUUID()}`
    let previousRef: string | undefined
    const committing = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      if (current.credentialTransactions[connectedId]) {
        throw new ModelConnectionConflictError(this['project'](current))
      }
      const existing = current.profiles[connectedId]
      const incarnationId = existing?.incarnationId ?? randomUUID()
      previousRef = existing?.credentialRef
      return {
        ...current,
        revision: current.revision + 1,
        profiles: existing && !existing.incarnationId
          ? { ...current.profiles, [connectedId]: { ...existing, incarnationId } }
          : current.profiles,
        credentialTransactions: {
          ...current.credentialTransactions,
          [connectedId]: {
            operationToken,
            clientId: randomUUID(),
            generation: 1,
            incarnationId,
            phase: 'committing',
            expiresAt: this['nowMs']() + this['credentialFenceTtlMs'](),
            previous: existing ? previousCredentialState(existing) : { configured: false },
            nextCredentialRef: nextRef,
            writerInstanceId: this['registryInstanceId'],
            writerPid: process.pid
          }
        }
      }
    })
    this['scheduleCredentialRecovery'](connectedId, committing.credentialTransactions[connectedId])
    try {
      await this['changed'](committing)
      await this['options'].credentials.set(nextRef, { apiKey: credential })
    } catch (error) {
      await this['abandonCredentialWrite'](connectedId, operationToken, nextRef)
      throw error
    }
    let document: RegistryDocument
    try {
      document = await this['file'].update(emptyDocument, (current) => {
        const transaction = current.credentialTransactions[connectedId]
        const existing = current.profiles[connectedId]
        if (
          transaction?.operationToken !== operationToken ||
          transaction.phase !== 'committing' ||
          transaction.nextCredentialRef !== nextRef ||
          (existing && existing.incarnationId !== transaction.incarnationId)
        ) {
          throw new ModelConnectionConflictError(this['project'](current))
        }
        const profile = profileFor(current, nextRef, transaction.incarnationId)
        const credentialTransactions = { ...current.credentialTransactions }
        delete credentialTransactions[connectedId]
        const tombstones = { ...current.tombstones }
        delete tombstones[connectedId]
        return {
          ...current,
          revision: current.revision + 1,
          profiles: { ...current.profiles, [connectedId]: profile },
          tombstones,
          credentialTransactions,
          credentialRefCleanup: appendCredentialRefs(
            current.credentialRefCleanup,
            this['nowMs'](),
            previousRef
          ),
          ...(input.select && profile.selectedModel ? {
            defaultProviderId: connectedId,
            defaultAccountId: profile.accountId,
            defaultModel: profile.selectedModel
          } : {})
        }
      })
    } catch (error) {
      await this['retireStaleCredentialWrite'](nextRef)
      throw error
    }
    this['cancelCredentialRecoveryTimer'](connectedId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    await this['retireLegacyCredentialSource'](connectedId)
    return this['projectWithCredentialHealth'](document)
  },

async connectInternal(this: ModelConnectionRegistry,
    raw: unknown,
    credentialSourceId?: string,
    trustedExternalAuth = false
  ): Promise<ModelConnectionSnapshot> {
    const input = ModelConnectionConnectRequestSchema.parse(raw)
    if (input.kind === 'http' && !input.baseUrl) throw new Error('baseUrl is required for HTTP providers')
    const models = input.probe && input.kind === 'http'
      ? await this['probeInput'](input)
      : uniqueModels(input.models)
    const usesRequestTimeCredential = input.kind === 'http' && Boolean(credentialSourceId)
    const credential = usesRequestTimeCredential ? '' : input.credential?.trim() ?? ''
    const selectedModel = input.selectedModel ?? models[0]
    if (selectedModel && models.length > 0 && !models.includes(selectedModel)) {
      throw new Error('selected model is not present in the provider model list')
    }
    let connectedId = ''

    if (credential) {
      const nextRef = `cred_${randomUUID()}`
      const operationToken = `connect:${randomUUID()}`
      const clientId = randomUUID()
      let incarnationId = ''
      const reserved = await this['file'].update(emptyDocument, (current) => {
        assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
        connectedId = allocateId(current, input.id ?? input.name)
        incarnationId = randomUUID()
        return {
          ...current,
          revision: current.revision + 1,
          credentialTransactions: {
            ...current.credentialTransactions,
            [connectedId]: {
              operationToken,
              clientId,
              generation: 1,
              incarnationId,
              phase: 'committing',
              expiresAt: this['nowMs']() + this['credentialFenceTtlMs'](),
              previous: { configured: false },
              nextCredentialRef: nextRef,
              writerInstanceId: this['registryInstanceId'],
              writerPid: process.pid
            }
          },
          credentialRefCleanup: appendCredentialRefs(
            current.credentialRefCleanup,
            this['nowMs'](),
            nextRef,
            this['registryInstanceId'],
            process.pid
          )
        }
      })
      this['scheduleCredentialRecovery'](connectedId, reserved.credentialTransactions[connectedId])
      try {
        await this['options'].credentials.set(nextRef, { apiKey: credential })
        await this['options'].afterCredentialConnectWrite?.(connectedId)
      } catch (error) {
        await this['abandonCredentialWrite'](connectedId, operationToken, nextRef)
        throw error
      }
      let document: RegistryDocument
      try {
        document = await this['file'].update(emptyDocument, (current) => {
          const transaction = current.credentialTransactions[connectedId]
          if (
            transaction?.operationToken !== operationToken ||
            transaction.phase !== 'committing' ||
            transaction.nextCredentialRef !== nextRef ||
            transaction.incarnationId !== incarnationId ||
            current.profiles[connectedId]
          ) {
            throw new ModelConnectionConflictError(this['project'](current))
          }
          const deleted = current.tombstones[connectedId]
          const accountId = `account:${connectedId}`
          const profile = StoredProfileSchema.parse({
            id: connectedId,
            accountId,
            name: input.name,
            presetSource: input.presetSource,
            ...(input.presetMode ? { presetMode: input.presetMode } : {}),
            kind: input.kind,
            authType: input.authType,
            baseUrl: input.baseUrl,
            endpointFormat: input.endpointFormat,
            configured: true,
            incarnationId,
            credentialMutationHighWater: deleted?.credentialMutationHighWater,
            models,
            ...(input.modelCapabilities
              ? { modelCapabilities: capabilitiesForModels(input.modelCapabilities, models) }
              : {}),
            selectedModel,
            credentialRef: nextRef,
            ...(deleted?.legacyCredentialSourceToRetire && this['options'].retireLegacyCredentialSource
              ? { legacyCredentialSourceToRetire: deleted.legacyCredentialSourceToRetire }
              : {})
          })
          const credentialTransactions = { ...current.credentialTransactions }
          delete credentialTransactions[connectedId]
          const credentialRefCleanup = { ...current.credentialRefCleanup }
          delete credentialRefCleanup[nextRef]
          const tombstones = { ...current.tombstones }
          delete tombstones[connectedId]
          return {
            ...current,
            revision: current.revision + 1,
            profiles: { ...current.profiles, [connectedId]: profile },
            tombstones,
            credentialTransactions,
            credentialRefCleanup,
            ...(input.select && selectedModel ? {
              defaultProviderId: connectedId,
              defaultAccountId: accountId,
              defaultModel: selectedModel
            } : {})
          }
        })
      } catch (error) {
        await this['abandonCredentialWrite'](connectedId, operationToken, nextRef)
        throw error
      }
      this['cancelCredentialRecoveryTimer'](connectedId)
      await this['changed'](document)
      await this['drainCredentialRefCleanup']()
      await this['retireLegacyCredentialSource'](connectedId)
      return this['projectWithCredentialHealth'](document)
    }

    const document = await this['file'].update(emptyDocument, (current) => {
      assertRevision(current, input.expectedRevision, this['options'].modelCapabilities, this['credentialHealth'])
      const id = allocateId(current, input.id ?? input.name)
      connectedId = id
      const deleted = current.tombstones[id]
      const accountId = `account:${id}`
      const configured = Boolean(credentialSourceId) ||
        input.kind === 'agent-sdk' ||
        trustedExternalAuth ||
        (input.kind === 'http' && isAnonymousHttpProfile({
          id: input.id ?? input.name,
          presetSource: input.presetSource
        }))
      const profile = StoredProfileSchema.parse({
        id,
        accountId,
        name: input.name,
        presetSource: input.presetSource,
        ...(input.presetMode ? { presetMode: input.presetMode } : {}),
        kind: input.kind,
        authType: input.authType,
        baseUrl: input.baseUrl,
        endpointFormat: input.endpointFormat,
        configured,
        incarnationId: randomUUID(),
        credentialMutationHighWater: deleted?.credentialMutationHighWater,
        models,
        ...(input.modelCapabilities
          ? { modelCapabilities: capabilitiesForModels(input.modelCapabilities, models) }
          : {}),
        selectedModel,
        credentialSourceId,
        ...(deleted?.legacyCredentialSourceToRetire && this['options'].retireLegacyCredentialSource
          ? { legacyCredentialSourceToRetire: deleted.legacyCredentialSourceToRetire }
          : {})
      })
      const tombstones = { ...current.tombstones }
      delete tombstones[id]
      return {
        ...current,
        revision: current.revision + 1,
        profiles: { ...current.profiles, [id]: profile },
        tombstones,
        ...(input.select && configured && selectedModel ? {
          defaultProviderId: id,
          defaultAccountId: accountId,
          defaultModel: selectedModel
        } : {})
      }
    })
    await this['changed'](document)
    if (document.profiles[connectedId]) await this['retireLegacyCredentialSource'](connectedId)
    return this['projectWithCredentialHealth'](document)
  },
}
