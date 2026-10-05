import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import { delegatedRouteKey, threadKey } from './delegated-session-binding-keys.js'
import type {
  DelegatedProviderKind,
  DelegatedSessionBinding,
  DelegatedSessionBindingStore,
  ParkedSession
} from './delegated-session-binding.js'

const MAX_NATIVE_SESSION_ID_LENGTH = 1_024
const MAX_IDENTITY_LENGTH = 1_024
const ROUTE_KEY_DIR = /^[a-f0-9]{64}$/

export class FileDelegatedSessionBindingStore implements DelegatedSessionBindingStore {
  private readonly bindingDir: string
  private readonly stateDir: string

  constructor(private readonly rootDir: string) {
    this.bindingDir = join(rootDir, 'bindings')
    this.stateDir = join(rootDir, 'provider-state')
  }

  async load(threadId: string): Promise<DelegatedSessionBinding | null> {
    const file = this.bindingFile(threadId)
    const binding = await file.read(() => null).catch(async () => {
      await this.deleteBinding(threadId, file)
      return null
    })
    if (!binding || binding.threadId !== threadId) {
      if (binding) await this.deleteBinding(threadId, file)
      return null
    }
    await this.migrateProviderState(binding)
    return binding
  }

  async save(binding: DelegatedSessionBinding): Promise<void> {
    const parsed = parseBinding(binding)
    if (!parsed) throw new Error('invalid delegated session binding')
    await withManagerDataMutex(this.resourceKey(binding.threadId), (context) =>
      context.withCommit(() => this.bindingFile(binding.threadId).write(parsed)))
  }

  async delete(threadId: string): Promise<void> {
    await withManagerDataMutex(this.resourceKey(threadId), async (context) => {
      await context.withCommit(async () => {
        await context.assertCurrent()
        await this.bindingFile(threadId).delete()
        await rm(this.providerStateRoot(threadId), { recursive: true, force: true })
        await context.assertCurrent()
      })
    })
  }

  async clearProviderState(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): Promise<void> {
    const directory = this.providerStateDir(providerKind, threadId, routeKey)
    await withManagerDataMutex(this.resourceKey(threadId), async (context) => {
      await context.withCommit(async () => {
        await context.assertCurrent()
        await rm(directory, { recursive: true, force: true })
        await mkdir(directory, { recursive: true, mode: 0o700 })
        await context.assertCurrent()
      })
    })
  }

  async removeProviderState(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): Promise<void> {
    const directory = this.providerStateDir(providerKind, threadId, routeKey)
    await withManagerDataMutex(this.resourceKey(threadId), (context) =>
      context.withCommit(async () => {
        await context.assertCurrent()
        await rm(directory, { recursive: true, force: true })
        await context.assertCurrent()
      }))
  }

  providerStateDir(
    providerKind: DelegatedProviderKind,
    threadId: string,
    routeKey: string
  ): string {
    return join(this.providerStateRoot(threadId), providerKind, routeKey)
  }

  /**
   * v1 bindings kept provider state at `provider-state/<thread>/<kind>`.
   * Move any unkeyed children of the bound kind dir under the binding's
   * route-key subdirectory (idempotent; hash-named children are skipped).
   */
  private async migrateProviderState(binding: DelegatedSessionBinding): Promise<void> {
    await withManagerDataMutex(this.resourceKey(binding.threadId), (context) =>
      context.withCommit(async () => {
        const kindDir = join(
          this.providerStateRoot(binding.threadId),
          binding.providerKind
        )
        const target = join(kindDir, delegatedRouteKey(binding))
        const entries = await readdir(kindDir, { withFileTypes: true }).catch(() => [])
        for (const entry of entries) {
          if (ROUTE_KEY_DIR.test(entry.name)) continue
          await mkdir(target, { recursive: true, mode: 0o700 })
          await rename(join(kindDir, entry.name), join(target, entry.name))
            .catch(() => undefined)
        }
      }))
  }

  private resourceKey(threadId: string): string {
    return `delegated-session:${threadId}`
  }

  private async deleteBinding(
    threadId: string,
    file = this.bindingFile(threadId)
  ): Promise<void> {
    await withManagerDataMutex(this.resourceKey(threadId), (context) =>
      context.withCommit(() => file.delete()))
  }

  private bindingPath(threadId: string): string {
    return join(this.bindingDir, `${threadKey(threadId)}.json`)
  }

  private bindingFile(threadId: string): AtomicJsonFile<DelegatedSessionBinding | null> {
    return new AtomicJsonFile(
      this.bindingPath(threadId),
      (value) => parseBinding(value)
    )
  }

  private providerStateRoot(threadId: string): string {
    return join(this.stateDir, threadKey(threadId))
  }
}

function parseBinding(value: unknown): DelegatedSessionBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const providerKind = record.providerKind
  const continuationMode = record.continuationMode
  if (
    (record.schemaVersion !== 1 && record.schemaVersion !== 2) ||
    typeof record.threadId !== 'string' ||
    !record.threadId ||
    !Number.isInteger(record.generation) ||
    Number(record.generation) < 1 ||
    (
      providerKind !== 'agent-sdk' &&
      providerKind !== 'cursor-sdk' &&
      providerKind !== 'antigravity-cli' &&
      providerKind !== 'acp' &&
      providerKind !== 'codex-app-server' &&
      providerKind !== 'pi-rpc'
    ) ||
    (continuationMode !== 'native' && continuationMode !== 'portable') ||
    !boundedString(record.providerId) ||
    !boundedString(record.credentialIdentity) ||
    !boundedString(record.workspace, 16_384) ||
    !boundedString(record.model) ||
    !hexDigest(record.capabilityFingerprint) ||
    !hexDigest(record.synchronizedHistoryDigest) ||
    !boundedString(record.lastCommittedTurnId) ||
    !boundedString(record.createdAt) ||
    !boundedString(record.updatedAt) ||
    (
      record.nativeSessionId !== undefined &&
      !boundedString(record.nativeSessionId, MAX_NATIVE_SESSION_ID_LENGTH)
    ) ||
    (
      record.handoffBriefDigest !== undefined &&
      !hexDigest(record.handoffBriefDigest)
    ) ||
    (
      record.priorItemCount !== undefined &&
      (!Number.isInteger(record.priorItemCount) || Number(record.priorItemCount) < 0)
    ) ||
    (
      record.parked !== undefined &&
      (!Array.isArray(record.parked) || !record.parked.every(isParkedSession))
    )
  ) return null
  // v1 files read as v2 with an empty parked list.
  return { ...record, schemaVersion: 2 } as DelegatedSessionBinding
}

function isParkedSession(value: unknown): value is ParkedSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const providerKind = record.providerKind
  const continuationMode = record.continuationMode
  return (
    hexDigest(record.key) &&
    (
      providerKind === 'agent-sdk' ||
      providerKind === 'cursor-sdk' ||
      providerKind === 'antigravity-cli' ||
      providerKind === 'acp' ||
      providerKind === 'codex-app-server' ||
      providerKind === 'pi-rpc'
    ) &&
    (continuationMode === 'native' || continuationMode === 'portable') &&
    boundedString(record.providerId) &&
    boundedString(record.credentialIdentity) &&
    boundedString(record.workspace, 16_384) &&
    boundedString(record.model) &&
    hexDigest(record.capabilityFingerprint) &&
    hexDigest(record.synchronizedHistoryDigest) &&
    boundedString(record.lastCommittedTurnId) &&
    boundedString(record.parkedAt) &&
    (
      record.nativeSessionId === undefined ||
      boundedString(record.nativeSessionId, MAX_NATIVE_SESSION_ID_LENGTH)
    ) &&
    (
      record.handoffBriefDigest === undefined ||
      hexDigest(record.handoffBriefDigest)
    ) &&
    (
      record.priorItemCount === undefined ||
      (Number.isInteger(record.priorItemCount) && Number(record.priorItemCount) >= 0)
    )
  )
}

function boundedString(value: unknown, max = MAX_IDENTITY_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function hexDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
