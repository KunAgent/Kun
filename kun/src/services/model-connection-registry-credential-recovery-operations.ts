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

export const modelConnectionRegistryCredentialRecoveryOperations = {
nowMs(this: ModelConnectionRegistry): number {
    return this['options'].nowMs?.() ?? Date.now()
  },

credentialFenceTtlMs(this: ModelConnectionRegistry): number {
    const configured = this['options'].credentialFenceTtlMs
    return configured !== undefined && Number.isFinite(configured) && configured > 0
      ? configured
      : 60_000
  },

clearPreparedCredentialSecret(this: ModelConnectionRegistry, providerId: string, operationToken?: string): void {
    const pending = this['preparedCredentialSecrets'].get(providerId)
    if (!pending || (operationToken && pending.operationToken !== operationToken)) return
    this['preparedCredentialSecrets'].delete(providerId)
    const timerKey = preparedCredentialSecretTimerKey(providerId, pending.operationToken)
    const timer = this['preparedCredentialSecretTimers'].get(timerKey)
    if (timer) clearTimeout(timer)
    this['preparedCredentialSecretTimers'].delete(timerKey)
  },

schedulePreparedCredentialSecretExpiry(this: ModelConnectionRegistry,
    providerId: string,
    operationToken: string,
    expiresAt: number
  ): void {
    const timerKey = preparedCredentialSecretTimerKey(providerId, operationToken)
    const previous = this['preparedCredentialSecretTimers'].get(timerKey)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this['clearPreparedCredentialSecret'](providerId, operationToken)
      this['preparedCredentialSecretTimers'].delete(timerKey)
    }, Math.min(Math.max(0, expiresAt - this['nowMs']()), 2_147_483_647))
    timer.unref?.()
    this['preparedCredentialSecretTimers'].set(timerKey, timer)
  },

cancelCredentialRecoveryTimer(this: ModelConnectionRegistry, providerId: string): void {
    const timer = this['credentialRecoveryTimers'].get(providerId)
    if (timer) clearTimeout(timer)
    this['credentialRecoveryTimers'].delete(providerId)
  },

scheduleCredentialRecoveries(this: ModelConnectionRegistry, document: RegistryDocument): void {
    for (const [providerId, transaction] of Object.entries(document.credentialTransactions)) {
      this['scheduleCredentialRecovery'](providerId, transaction)
    }
  },

scheduleCredentialRecovery(this: ModelConnectionRegistry,
    providerId: string,
    transaction: CredentialTransaction | undefined
  ): void {
    this['cancelCredentialRecoveryTimer'](providerId)
    if (!transaction) return
    const delay = transaction.phase === 'recovering'
      ? 1_000
      : Math.max(0, transaction.expiresAt - this['nowMs']())
    const timer = setTimeout(() => {
      void this['recoverExpiredCredentialTransaction'](providerId, transaction.operationToken)
        .catch(() => undefined)
        .finally(async () => {
          const current = (await this['file'].read(emptyDocument)).credentialTransactions[providerId]
          if (current) this['scheduleCredentialRecovery'](providerId, current)
        })
    }, Math.min(delay, 2_147_483_647))
    timer.unref?.()
    this['credentialRecoveryTimers'].set(providerId, timer)
  },

async readDocumentForCredentialConsumer(this: ModelConnectionRegistry, providerId: string): Promise<RegistryDocument> {
    await this['recoverExpiredCredentialTransaction'](providerId).catch(() => undefined)
    return this['file'].read(emptyDocument)
  },

async recoverExpiredCredentialTransactions(this: ModelConnectionRegistry, document: RegistryDocument): Promise<void> {
    for (const [providerId, transaction] of Object.entries(document.credentialTransactions)) {
      const writerDied = transaction.writerPid !== undefined && !this['isProcessAlive'](transaction.writerPid)
      if (transaction.phase === 'recovering' || transaction.expiresAt <= this['nowMs']() || writerDied) {
        await this['recoverExpiredCredentialTransaction'](providerId, transaction.operationToken)
          .catch(() => undefined)
      } else {
        this['scheduleCredentialRecovery'](providerId, transaction)
      }
    }
  },

/**
   * Restores the previous durable credential while the global fence remains
   * installed. Only after the live apply succeeds is the matching transaction
   * removed. A failed apply therefore remains fail-closed and is retried.
   */
async recoverExpiredCredentialTransaction(this: ModelConnectionRegistry,
    providerId: string,
    operationToken?: string
  ): Promise<boolean> {
    let recover = false
    let removedOrphan = false
    let durableTokenMissingOrMismatch = false
    let token = operationToken
    const recovering = await this['file'].update(emptyDocument, (current) => {
      const transaction = current.credentialTransactions[providerId]
      if (!transaction || (token && transaction.operationToken !== token)) {
        durableTokenMissingOrMismatch = true
        return current
      }
      token = transaction.operationToken
      const writerDied = transaction.writerPid !== undefined && !this['isProcessAlive'](transaction.writerPid)
      if (
        transaction.phase !== 'recovering' &&
        transaction.expiresAt > this['nowMs']() &&
        !writerDied
      ) {
        return current
      }
      if (
        transaction.phase === 'recovering' &&
        transaction.recoveryOwnerId !== this['registryInstanceId'] &&
        transaction.recoveryOwnerPid !== undefined &&
        this['isProcessAlive'](transaction.recoveryOwnerPid)
      ) {
        return current
      }
      const profile = current.profiles[providerId]
      if (!profile || profile.incarnationId !== transaction.incarnationId) {
        const credentialTransactions = { ...current.credentialTransactions }
        delete credentialTransactions[providerId]
        removedOrphan = true
        return {
          ...current,
          revision: current.revision + 1,
          credentialTransactions,
          credentialRefCleanup: appendCredentialRefs(
            current.credentialRefCleanup,
            this['nowMs'](),
            transaction.nextCredentialRef,
            transaction.writerInstanceId,
            transaction.writerPid
          )
        }
      }
      recover = true
      if (
        transaction.phase === 'recovering' &&
        transaction.recoveryOwnerId === this['registryInstanceId'] &&
        (!transaction.nextCredentialRef || Boolean(current.credentialRefCleanup[transaction.nextCredentialRef]))
      ) return current
      return {
        ...current,
        revision: current.revision + 1,
        credentialTransactions: {
          ...current.credentialTransactions,
          [providerId]: {
            ...transaction,
            phase: 'recovering',
            recoveryOwnerId: this['registryInstanceId'],
            recoveryOwnerPid: process.pid
          }
        },
        credentialRefCleanup: appendCredentialRefs(
          current.credentialRefCleanup,
          this['nowMs'](),
          transaction.nextCredentialRef,
          transaction.writerInstanceId,
          transaction.writerPid
        )
      }
    })
    // Another Registry can supersede, commit, clear, or delete the durable
    // transaction without touching this process's prepared plaintext. The old
    // timer still identifies its local token, so release only that generation
    // and leave the newer durable state completely untouched.
    if (durableTokenMissingOrMismatch && operationToken) {
      this['clearPreparedCredentialSecret'](providerId, operationToken)
    }
    if (removedOrphan) {
      this['clearPreparedCredentialSecret'](providerId, token)
      this['cancelCredentialRecoveryTimer'](providerId)
      await this['changed'](recovering)
      await this['drainCredentialRefCleanup']()
      return true
    }
    if (!recover || !token) {
      const current = recovering.credentialTransactions[providerId]
      if (current) this['scheduleCredentialRecovery'](providerId, current)
      return false
    }

    const operation = this['changeOperation'].then(async () => {
      const current = await this['file'].read(emptyDocument)
      const transaction = current.credentialTransactions[providerId]
      if (
        transaction?.operationToken !== token ||
        transaction.phase !== 'recovering' ||
        transaction.recoveryOwnerId !== this['registryInstanceId']
      ) return false
      await this['options'].onChanged?.(await this['materializeDocument'](current, providerId))
      const afterApply = await this['file'].read(emptyDocument)
      const afterTransaction = afterApply.credentialTransactions[providerId]
      if (
        afterTransaction?.operationToken !== token ||
        afterTransaction.phase !== 'recovering' ||
        afterTransaction.recoveryOwnerId !== this['registryInstanceId']
      ) {
        await this['apply'](afterApply)
        return false
      }
      return true
    })
    this['changeOperation'] = operation.then(() => undefined, () => undefined)
    let applied: boolean
    try {
      applied = await operation
    } catch (error) {
      const current = (await this['file'].read(emptyDocument)).credentialTransactions[providerId]
      if (current?.operationToken === token) this['scheduleCredentialRecovery'](providerId, current)
      throw error
    }
    if (!applied) return false

    let finalized = false
    const document = await this['file'].update(emptyDocument, (current) => {
      const transaction = current.credentialTransactions[providerId]
      const profile = current.profiles[providerId]
      if (
        transaction?.operationToken !== token ||
        transaction.phase !== 'recovering' ||
        transaction.recoveryOwnerId !== this['registryInstanceId'] ||
        !profile ||
        profile.incarnationId !== transaction.incarnationId
      ) return current
      const credentialTransactions = { ...current.credentialTransactions }
      delete credentialTransactions[providerId]
      finalized = true
      return {
        ...current,
        revision: current.revision + 1,
        credentialTransactions
      }
    })
    if (!finalized) {
      await this['applyLatest']()
      return false
    }
    this['clearPreparedCredentialSecret'](providerId, token)
    this['cancelCredentialRecoveryTimer'](providerId)
    await this['changed'](document)
    await this['drainCredentialRefCleanup']()
    return true
  },

async drainCredentialRefCleanup(this: ModelConnectionRegistry): Promise<void> {
    const initial = await this['file'].read(emptyDocument)
    for (const entry of Object.values(initial.credentialRefCleanup)) {
      const { reference } = entry
      const current = await this['file'].read(emptyDocument)
      const latestEntry = current.credentialRefCleanup[reference]
      if (!latestEntry) continue
      if (credentialReferenceIsLive(current, reference)) continue
      if (latestEntry.writerPid && this['isProcessAlive'](latestEntry.writerPid)) continue
      try {
        await this['options'].credentials.delete(reference)
      } catch {
        continue
      }
      await this['file'].update(emptyDocument, (latest) => {
        const candidate = latest.credentialRefCleanup[reference]
        if (!candidate || credentialReferenceIsLive(latest, reference)) return latest
        if (candidate.writerPid && this['isProcessAlive'](candidate.writerPid)) return latest
        const credentialRefCleanup = { ...latest.credentialRefCleanup }
        delete credentialRefCleanup[reference]
        return { ...latest, credentialRefCleanup }
      })
    }
  },

isProcessAlive(this: ModelConnectionRegistry, pid: number): boolean {
    return this['options'].isProcessAlive?.(pid) ?? processIsAlive(pid)
  },

async retireStaleCredentialWrite(this: ModelConnectionRegistry, reference: string): Promise<void> {
    let deleted = false
    try {
      await this['options'].credentials.delete(reference)
      deleted = true
    } catch {
      // The writer is still able to durably acknowledge that it will never
      // write this ref again. Preserve a retryable cleanup entry without the
      // live-writer lease instead of dropping the ref after a failed delete.
    }
    await this['file'].update(emptyDocument, (current) => {
      const entry = current.credentialRefCleanup[reference]
      if (!entry || credentialReferenceIsLive(current, reference)) return current
      if (entry.writerInstanceId && entry.writerInstanceId !== this['registryInstanceId']) return current
      const credentialRefCleanup = { ...current.credentialRefCleanup }
      if (deleted) {
        delete credentialRefCleanup[reference]
      } else {
        credentialRefCleanup[reference] = {
          reference,
          enqueuedAt: entry.enqueuedAt
        }
      }
      return { ...current, credentialRefCleanup }
    })
  },

async abandonCredentialWrite(this: ModelConnectionRegistry,
    providerId: string,
    operationToken: string,
    reference: string
  ): Promise<void> {
    await this['options'].credentials.delete(reference).catch(() => undefined)
    await this['file'].update(emptyDocument, (current) => {
      const transaction = current.credentialTransactions[providerId]
      if (
        transaction?.operationToken !== operationToken ||
        transaction.nextCredentialRef !== reference ||
        transaction.writerInstanceId !== this['registryInstanceId']
      ) {
        const entry = current.credentialRefCleanup[reference]
        if (
          !entry ||
          entry.writerInstanceId !== this['registryInstanceId'] ||
          credentialReferenceIsLive(current, reference)
        ) return current
        return {
          ...current,
          credentialRefCleanup: {
            ...current.credentialRefCleanup,
            [reference]: {
              reference,
              enqueuedAt: entry.enqueuedAt
            }
          }
        }
      }
      return {
        ...current,
        revision: current.revision + 1,
        credentialTransactions: {
          ...current.credentialTransactions,
          [providerId]: {
            ...transaction,
            phase: 'recovering',
            expiresAt: this['nowMs'](),
            writerInstanceId: undefined,
            writerPid: undefined,
            recoveryOwnerId: this['registryInstanceId'],
            recoveryOwnerPid: process.pid
          }
        },
        credentialRefCleanup: appendCredentialRefs(
          current.credentialRefCleanup,
          this['nowMs'](),
          reference
        )
      }
    })
    await this['recoverExpiredCredentialTransaction'](providerId, operationToken).catch(() => undefined)
    await this['drainCredentialRefCleanup']()
  },

/**
   * Registry file updates are already serialized by AtomicJsonFile, but live
   * application can include slower asynchronous model-runtime construction.
   * Serialize that second phase as well and always read the newest durable
   * document when a queued application begins. This prevents an older GUI/TUI
   * write from finishing late and replacing a newer runtime generation.
   */
async applyLatest(this: ModelConnectionRegistry): Promise<void> {
    const operation = this['changeOperation'].then(async () => {
      const document = await this['file'].read(emptyDocument)
      if (document.revision <= this['lastAppliedRevision']) return
      await this['apply'](document)
      this['lastAppliedRevision'] = document.revision
      const snapshot = await this['projectWithCredentialHealth'](document)
      for (const listener of this['listeners']) listener(snapshot)
    })
    this['changeOperation'] = operation.catch(() => undefined)
    await operation
  },

project(this: ModelConnectionRegistry, document: RegistryDocument): ModelConnectionSnapshot {
    return project(document, this['options'].modelCapabilities, this['credentialHealth'])
  },

async projectWithCredentialHealth(this: ModelConnectionRegistry,
    document: RegistryDocument
  ): Promise<ModelConnectionSnapshot> {
    const health = await this['inspectCredentialHealth'](document)
    if (document.revision >= this['credentialHealthRevision']) {
      this['credentialHealthRevision'] = document.revision
      this['credentialHealth'] = new Map(health)
    }
    return project(document, this['options'].modelCapabilities, health)
  },

async inspectCredentialHealth(this: ModelConnectionRegistry,
    document: RegistryDocument
  ): Promise<ReadonlyMap<string, ProjectedCredentialHealth>> {
    const entries = await Promise.all(Object.values(document.profiles).map(async (profile) => {
      if (document.credentialTransactions[profile.id]) {
        return [profile.id, credentialHealth('missing')] as const
      }
      if (profile.credentialRef) {
        try {
          const credential = await this['options'].credentials.get(profile.credentialRef)
          return [profile.id, credential?.apiKey?.trim()
            ? credentialHealth('ready')
            : credentialHealth('missing')] as const
        } catch {
          return [profile.id, credentialHealth('unreadable')] as const
        }
      }
      if (profile.credentialSourceId && this['options'].inspectCredentialSource) {
        try {
          const status = await this['options'].inspectCredentialSource(profile.credentialSourceId)
          return [profile.id, credentialHealth(status)] as const
        } catch {
          return [profile.id, credentialHealth('unreadable')] as const
        }
      }
      // Anonymous HTTP providers authenticate by sending no credential at
      // all, so the absence of one is the healthy state, not a missing one.
      if (profile.configured && profile.kind === 'http' && isAnonymousHttpProfile(profile)) {
        return [profile.id, credentialHealth('ready')] as const
      }
      if (!profile.configured && profile.kind === 'http') {
        return [profile.id, credentialHealth('missing')] as const
      }
      return null
    }))
    return new Map(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null))
  },
}
