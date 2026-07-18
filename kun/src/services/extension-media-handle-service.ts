import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'

const MediaHandleModeSchema = z.enum(['read', 'write'])
const MediaHandleSourceSchema = z.enum(['workspace', 'picker', 'generated'])
const MediaHandleLifecycleSchema = z.enum(['persistent', 'cache'])
const FileIdentitySchema = z.strictObject({
  size: z.number().int().nonnegative(),
  mtimeMs: z.number().nonnegative(),
  // Windows can report NTFS identifiers above Number.MAX_SAFE_INTEGER. They
  // are useful hardening signals, but must not make a valid media handle
  // impossible to persist in JSON.
  device: z.number().int().nonnegative().optional(),
  inode: z.number().int().nonnegative().optional()
})
const StoredMediaHandleSchema = z.strictObject({
  id: z.string().min(1),
  ownerExtensionId: z.string().min(1),
  ownerExtensionVersion: z.string().min(1),
  workspaceRoot: z.string().min(1),
  absolutePath: z.string().min(1),
  displayName: z.string().min(1).max(256),
  mode: MediaHandleModeSchema,
  source: MediaHandleSourceSchema,
  lifecycle: MediaHandleLifecycleSchema.default('persistent'),
  mimeType: z.string().min(1).max(128),
  identity: FileIdentitySchema.optional(),
  previousIdentity: FileIdentitySchema.optional(),
  createdAt: z.string().datetime(),
  lastAccessedAt: z.string().datetime().optional(),
  reservationId: z.string().min(1).max(256).optional(),
  completedAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional()
})
const MediaHandleDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  handles: z.record(z.string(), StoredMediaHandleSchema)
})

type StoredMediaHandle = z.infer<typeof StoredMediaHandleSchema>
type MediaHandleMode = z.infer<typeof MediaHandleModeSchema>
type MediaHandleSource = z.infer<typeof MediaHandleSourceSchema>
type MediaHandleLifecycle = z.infer<typeof MediaHandleLifecycleSchema>
export type FileIdentity = z.infer<typeof FileIdentitySchema>

export type MediaHandleProjection = {
  id: string
  displayName: string
  mode: MediaHandleMode
  source: MediaHandleSource
  /** Core-only lifecycle. Public metadata deliberately omits this field. */
  lifecycle?: MediaHandleLifecycle
  mimeType: string
  byteSize?: number
  modifiedAt?: string
  completionIdentity?: string
  workspaceRelativePath?: string
  available: boolean
  createdAt: string
  lastAccessedAt: string
}

export type ResolvedMediaHandle = MediaHandleProjection & {
  absolutePath: string
  workspaceRoot: string
  ownerExtensionId: string
  ownerExtensionVersion: string
  identity?: FileIdentity
}

/**
 * Core-only reversible completion used while a durable media job is still
 * waiting for semantic output validation and its terminal fence. Public
 * extensions never receive this object or the captured handle records.
 */
export type MediaOutputCompletionTransaction = {
  generatedMedia: MediaHandleProjection[]
  commit(): Promise<void>
  rollback(): Promise<void>
}

export type PendingMediaOutputTransaction = {
  handleId: string
  absolutePath: string
  completed: boolean
  hadTarget: boolean
  originalIdentity?: FileIdentity
  completedIdentity?: FileIdentity
}

export type CompletedMediaOutputRecovery = {
  handleId: string
  absolutePath: string
  completedIdentity: FileIdentity
}

export class ExtensionMediaHandleError extends Error {
  constructor(
    readonly code:
      | 'permission_denied'
      | 'workspace_untrusted'
      | 'workspace_denied'
      | 'not_found'
      | 'not_regular_file'
      | 'path_escape'
      | 'file_changed'
      | 'mode_denied'
      | 'handle_reserved'
      | 'handle_consumed'
      | 'handle_limit',
    message: string
  ) {
    super(message)
  }
}

export type RegisterMediaHandleInput = {
  workspaceRoot: string
  path: string
  mode: MediaHandleMode
  source: MediaHandleSource
  lifecycle?: MediaHandleLifecycle
  displayName?: string
  mimeType?: string
}

export type RegisterCacheMediaTargetInput = Pick<
  RegisterMediaHandleInput,
  'workspaceRoot' | 'path' | 'displayName' | 'mimeType'
>

const emptyDocument = () => ({
  schemaVersion: 1 as const,
  revision: 0,
  handles: {}
})

/**
 * Runtime-owned durable media authority. Public callers receive projections;
 * only trusted core services can resolve a handle back to an absolute path.
 */
export class ExtensionMediaHandleService {
  private readonly store: AtomicJsonFile<z.infer<typeof MediaHandleDocumentSchema>>
  private readonly now: () => Date
  private readonly maxHandlesPerExtension: number

  constructor(options: {
    dataDir: string
    now?: () => Date
    maxHandlesPerExtension?: number
  }) {
    this.store = new AtomicJsonFile(
      join(options.dataDir, 'extensions', 'media-handles.json'),
      (value) => MediaHandleDocumentSchema.parse(value)
    )
    this.now = options.now ?? (() => new Date())
    this.maxHandlesPerExtension = Math.max(1, Math.floor(options.maxHandlesPerExtension ?? 512))
  }

  async register(
    principal: ExtensionPrincipal,
    input: RegisterMediaHandleInput
  ): Promise<MediaHandleProjection> {
    const workspaceRoot = await authorizeWorkspace(principal, input.workspaceRoot)
    requirePermission(principal, input.mode === 'read' ? 'media.read' : 'media.export')
    requirePermission(principal, input.mode === 'read' ? 'workspace.read' : 'workspace.write')
    return await this.registerAuthorized(principal, { ...input, workspaceRoot })
  }

  /**
   * Core-only cache authority used by the Host broker. A cache target is not a
   * user export grant: it is confined to the Host-owned extension cache and is
   * authorized by media processing plus workspace write access. Public callers
   * cannot choose its lifecycle, source, or access mode.
   */
  async registerCacheTarget(
    principal: ExtensionPrincipal,
    input: RegisterCacheMediaTargetInput
  ): Promise<MediaHandleProjection> {
    const workspaceRoot = await authorizeWorkspace(principal, input.workspaceRoot)
    requirePermission(principal, 'media.process')
    requirePermission(principal, 'workspace.write')
    const target = assertExtensionCacheTarget(principal, workspaceRoot, input.path)
    await ensureCacheParent(workspaceRoot, target)
    return await this.registerAuthorized(principal, {
      ...input,
      workspaceRoot,
      mode: 'write',
      source: 'workspace',
      lifecycle: 'cache'
    })
  }

  private async registerAuthorized(
    principal: ExtensionPrincipal,
    input: RegisterMediaHandleInput & { workspaceRoot: string }
  ): Promise<MediaHandleProjection> {
    const candidate = await resolveCandidate(input)
    const createdAt = this.now().toISOString()
    const record: StoredMediaHandle = {
      id: `media_${randomUUID()}`,
      ownerExtensionId: principal.extensionId,
      ownerExtensionVersion: principal.extensionVersion,
      workspaceRoot: input.workspaceRoot,
      absolutePath: candidate.absolutePath,
      displayName: boundedDisplayName(input.displayName ?? basename(candidate.absolutePath)),
      mode: input.mode,
      source: input.source,
      lifecycle: input.lifecycle ?? 'persistent',
      mimeType: input.mimeType?.trim() || inferMediaMime(candidate.absolutePath),
      ...(candidate.identity ? { identity: candidate.identity } : {}),
      createdAt,
      lastAccessedAt: createdAt
    }
    await this.store.update(emptyDocument, (document) => {
      const owned = Object.values(document.handles).filter(
        (handle) => handle.ownerExtensionId === principal.extensionId && !handle.revokedAt
      ).length
      if (owned >= this.maxHandlesPerExtension) {
        throw new ExtensionMediaHandleError('handle_limit', 'Extension media handle limit reached')
      }
      return {
        ...document,
        revision: document.revision + 1,
        handles: { ...document.handles, [record.id]: record }
      }
    })
    return project(record)
  }

  async stat(principal: ExtensionPrincipal, handleId: string): Promise<MediaHandleProjection> {
    const record = await this.requireOwned(principal, handleId)
    await authorizeWorkspace(principal, record.workspaceRoot)
    requireRecordAccess(principal, record, record.mode)
    return project(await refreshIdentity(record))
  }

  /**
   * Runtime-only access accounting. It is called only after a protected View
   * resource lease succeeds, so metadata polling does not artificially refresh
   * cache LRU order.
   */
  async touch(principal: ExtensionPrincipal, handleId: string): Promise<MediaHandleProjection> {
    const current = await this.requireOwned(principal, handleId)
    await authorizeWorkspace(principal, current.workspaceRoot)
    if (current.mode !== 'read') {
      throw new ExtensionMediaHandleError('mode_denied', 'Only readable media can be opened in a View')
    }
    requireRecordAccess(principal, current, 'read')
    await refreshIdentity(current)
    const lastAccessedAt = this.now().toISOString()
    let touched: StoredMediaHandle | undefined
    await this.store.update(emptyDocument, (document) => {
      const record = document.handles[handleId]
      assertOwnedRecord(record, principal)
      if (record.mode !== 'read') {
        throw new ExtensionMediaHandleError('mode_denied', 'Only readable media can be opened in a View')
      }
      if ((record.lastAccessedAt ?? record.createdAt) >= lastAccessedAt) {
        touched = record
        return document
      }
      touched = { ...record, lastAccessedAt }
      return {
        ...document,
        revision: document.revision + 1,
        handles: { ...document.handles, [handleId]: touched }
      }
    })
    return project(touched ?? current)
  }

  async resolve(
    principal: ExtensionPrincipal,
    handleId: string,
    requiredMode: MediaHandleMode
  ): Promise<ResolvedMediaHandle> {
    const record = await this.requireOwned(principal, handleId)
    await authorizeWorkspace(principal, record.workspaceRoot)
    if (record.mode !== requiredMode) {
      throw new ExtensionMediaHandleError('mode_denied', 'Media handle access mode is not permitted')
    }
    requireRecordAccess(principal, record, requiredMode)
    const refreshed = await refreshIdentity(record)
    return {
      ...project(refreshed),
      absolutePath: refreshed.absolutePath,
      workspaceRoot: refreshed.workspaceRoot,
      ownerExtensionId: refreshed.ownerExtensionId,
      ownerExtensionVersion: refreshed.ownerExtensionVersion,
      ...(refreshed.identity ? { identity: refreshed.identity } : {})
    }
  }

  async release(principal: ExtensionPrincipal, handleId: string): Promise<boolean> {
    let released = false
    let cachePath: string | undefined
    await this.store.update(emptyDocument, (document) => {
      const record = document.handles[handleId]
      if (!record || record.ownerExtensionId !== principal.extensionId ||
        record.ownerExtensionVersion !== principal.extensionVersion) return document
      if (record.revokedAt) return document
      released = true
      if (record.lifecycle === 'cache') cachePath = record.absolutePath
      const revokedAt = this.now().toISOString()
      const handles = cachePath === undefined
        ? { ...document.handles, [handleId]: { ...record, revokedAt } }
        : Object.fromEntries(Object.entries(document.handles).map(([id, candidate]) => [
            id,
            candidate.ownerExtensionId === principal.extensionId &&
            candidate.ownerExtensionVersion === principal.extensionVersion &&
            candidate.lifecycle === 'cache' &&
            candidate.absolutePath === cachePath &&
            !candidate.revokedAt
              ? { ...candidate, revokedAt }
              : candidate
          ]))
      return {
        ...document,
        revision: document.revision + 1,
        handles
      }
    })
    if (cachePath !== undefined) await rm(cachePath, { force: true })
    return released
  }

  async reserveOutput(
    principal: ExtensionPrincipal,
    handleId: string,
    reservationId: string
  ): Promise<ResolvedMediaHandle> {
    if (!reservationId || reservationId.length > 256) {
      throw new ExtensionMediaHandleError('handle_reserved', 'Invalid output reservation')
    }
    const current = await this.resolve(principal, handleId, 'write')
    let reserved: StoredMediaHandle | undefined
    await this.store.update(emptyDocument, (document) => {
      const record = document.handles[handleId]
      assertOwnedRecord(record, principal)
      if (record.mode !== 'write') {
        throw new ExtensionMediaHandleError('mode_denied', 'Media handle is not an export target')
      }
      if (record.completedAt) {
        throw new ExtensionMediaHandleError('handle_consumed', 'Export target was already consumed')
      }
      if (record.reservationId && record.reservationId !== reservationId) {
        throw new ExtensionMediaHandleError('handle_reserved', 'Export target is already reserved')
      }
      reserved = { ...record, reservationId }
      return {
        ...document,
        revision: document.revision + 1,
        handles: { ...document.handles, [handleId]: reserved }
      }
    })
    return { ...current, ...(reserved ? { identity: reserved.identity } : {}) }
  }

  async releaseOutputReservation(
    principal: ExtensionPrincipal,
    handleId: string,
    reservationId: string
  ): Promise<boolean> {
    let released = false
    await this.store.update(emptyDocument, (document) => {
      const record = document.handles[handleId]
      if (!record || record.ownerExtensionId !== principal.extensionId ||
        record.ownerExtensionVersion !== principal.extensionVersion ||
        record.reservationId !== reservationId || record.completedAt || record.revokedAt) {
        return document
      }
      released = true
      const { reservationId: _, ...next } = record
      return {
        ...document,
        revision: document.revision + 1,
        handles: { ...document.handles, [handleId]: next }
      }
    })
    return released
  }

  /**
   * Consumes an export grant after atomic promotion and returns a new readable
   * generated-media handle. The destination path never leaves this service.
   */
  async completeOutput(
    principal: ExtensionPrincipal,
    handleId: string,
    reservationId: string
  ): Promise<MediaHandleProjection> {
    return (await this.completeOutputs(principal, [{ handleId, reservationId }]))[0]!
  }

  /**
   * Completes a set of already-promoted outputs in one store revision. All
   * filesystem identities and reservations are validated before any export
   * grant is consumed, so callers can safely roll the file promotion back if
   * this method rejects.
   */
  async completeOutputs(
    principal: ExtensionPrincipal,
    outputs: Array<{ handleId: string; reservationId: string }>,
    options: { signal?: AbortSignal } = {}
  ): Promise<MediaHandleProjection[]> {
    const transaction = await this.completeOutputsReversibly(principal, outputs, options)
    await transaction.commit()
    return transaction.generatedMedia
  }

  /**
   * Completes output grants atomically but retains enough core-private state to
   * undo that completion until the owning durable job commits successfully.
   * The caller must invoke exactly one of commit or rollback; both operations
   * are idempotent for the same terminal choice and reject conflicting choices.
   */
  async completeOutputsReversibly(
    principal: ExtensionPrincipal,
    outputs: Array<{ handleId: string; reservationId: string }>,
    options: { signal?: AbortSignal } = {}
  ): Promise<MediaOutputCompletionTransaction> {
    options.signal?.throwIfAborted()
    if (outputs.length < 1 || outputs.length > 16 ||
      new Set(outputs.map(({ handleId }) => handleId)).size !== outputs.length) {
      throw new ExtensionMediaHandleError('handle_reserved', 'Export target completion set is invalid')
    }
    const prepared = await Promise.all(outputs.map(async ({ handleId, reservationId }) => {
      const before = await this.requireOwned(principal, handleId)
      if (before.mode !== 'write' || before.reservationId !== reservationId || before.completedAt) {
        throw new ExtensionMediaHandleError('handle_reserved', 'Export target reservation is not active')
      }
      return { handleId, reservationId, before, identity: await readIdentity(before.absolutePath) }
    }))
    options.signal?.throwIfAborted()
    const createdAt = this.now().toISOString()
    const generated = prepared.map(({ before, identity }) => {
      const record: StoredMediaHandle = {
        ...before,
        id: `media_${randomUUID()}`,
        mode: 'read',
        source: 'generated',
        identity,
        createdAt,
        lastAccessedAt: createdAt
      }
      delete record.completedAt
      delete record.revokedAt
      delete record.previousIdentity
      return record
    })
    const completed = prepared.map(({ before, identity }) => {
      const record: StoredMediaHandle = {
        ...before,
        identity,
        ...(before.identity ? { previousIdentity: before.identity } : {}),
        completedAt: createdAt,
        revokedAt: createdAt
      }
      return record
    })
    await this.store.update(emptyDocument, (document) => {
      options.signal?.throwIfAborted()
      const handles = { ...document.handles }
      for (let index = 0; index < prepared.length; index += 1) {
        const { handleId, reservationId } = prepared[index]!
        const record = handles[handleId]
        assertOwnedRecord(record, principal)
        if (record.mode !== 'write' || record.reservationId !== reservationId || record.completedAt) {
          throw new ExtensionMediaHandleError('handle_reserved', 'Export target reservation is not active')
        }
        handles[handleId] = completed[index]!
        const readable = generated[index]!
        if (handles[readable.id] !== undefined) {
          throw new ExtensionMediaHandleError('handle_limit', 'Generated media handle identity collided')
        }
        handles[readable.id] = readable
      }
      return {
        ...document,
        revision: document.revision + 1,
        handles
      }
    })
    const generatedMedia = generated.map(project)
    let state: 'pending' | 'committed' | 'rolled-back' = 'pending'
    let transition = Promise.resolve()
    const serialize = async (
      target: 'committed' | 'rolled-back',
      operation: () => Promise<void>
    ): Promise<void> => {
      const prior = transition
      let release!: () => void
      transition = new Promise<void>((resolvePromise) => { release = resolvePromise })
      await prior
      try {
        if (state === target) return
        if (state !== 'pending') {
          throw new ExtensionMediaHandleError(
            'handle_consumed',
            'Output completion transaction already reached another terminal state'
          )
        }
        await operation()
        state = target
      } finally {
        release()
      }
    }
    return {
      generatedMedia,
      commit: () => serialize('committed', async () => {
        await this.store.update(emptyDocument, (document) => {
          const handles = { ...document.handles }
          for (let index = 0; index < prepared.length; index += 1) {
            const original = prepared[index]!.before
            const generatedRecord = generated[index]!
            const currentOriginal = handles[original.id]
            const currentGenerated = handles[generatedRecord.id]
            if (
              !currentOriginal ||
              !currentGenerated ||
              !isDeepStrictEqual(currentOriginal, completed[index]!) ||
              !isDeepStrictEqual(currentGenerated, generatedRecord)
            ) {
              throw new ExtensionMediaHandleError(
                'handle_consumed',
                'Output completion changed before commit'
              )
            }
            const finalizedOriginal = { ...currentOriginal }
            const finalizedGenerated = { ...currentGenerated }
            delete finalizedOriginal.reservationId
            delete finalizedOriginal.previousIdentity
            delete finalizedGenerated.reservationId
            handles[original.id] = finalizedOriginal
            handles[generatedRecord.id] = finalizedGenerated
          }
          return {
            ...document,
            revision: document.revision + 1,
            handles
          }
        })
      }),
      rollback: () => serialize('rolled-back', async () => {
        await this.store.update(emptyDocument, (document) => {
          const handles = { ...document.handles }
          for (let index = 0; index < prepared.length; index += 1) {
            const original = prepared[index]!.before
            const completedRecord = completed[index]!
            const generatedRecord = generated[index]!
            if (
              !isDeepStrictEqual(handles[original.id], completedRecord) ||
              !isDeepStrictEqual(handles[generatedRecord.id], generatedRecord)
            ) {
              throw new ExtensionMediaHandleError(
                'handle_consumed',
                'Output completion changed before rollback'
              )
            }
          }
          for (let index = 0; index < prepared.length; index += 1) {
            const original = prepared[index]!.before
            handles[original.id] = original
            delete handles[generated[index]!.id]
          }
          return {
            ...document,
            revision: document.revision + 1,
            handles
          }
        })
      })
    }
  }

  /** Core-only recovery projection for an interrupted output reservation. */
  async inspectOutputTransaction(
    principal: ExtensionPrincipal,
    handleId: string,
    reservationId: string
  ): Promise<PendingMediaOutputTransaction> {
    const record = (await this.store.read(emptyDocument)).handles[handleId]
    assertOwnedTransactionRecord(record, principal)
    await authorizeWorkspace(principal, record.workspaceRoot)
    if (record.mode !== 'write' || record.reservationId !== reservationId) {
      throw new ExtensionMediaHandleError('handle_reserved', 'Output transaction is not active')
    }
    const originalIdentity = record.completedAt === undefined
      ? record.identity
      : record.previousIdentity
    return {
      handleId,
      absolutePath: record.absolutePath,
      completed: record.completedAt !== undefined,
      hadTarget: originalIdentity !== undefined,
      ...(originalIdentity ? { originalIdentity } : {}),
      ...(record.completedAt !== undefined && record.identity
        ? { completedIdentity: record.identity }
        : {})
    }
  }

  /** Core-only projection used to remove deterministic recovery files. */
  async inspectCompletedOutput(
    principal: ExtensionPrincipal,
    handleId: string
  ): Promise<CompletedMediaOutputRecovery> {
    const record = (await this.store.read(emptyDocument)).handles[handleId]
    assertOwnedRecordIncludingRevoked(record, principal)
    await authorizeWorkspace(principal, record.workspaceRoot)
    if (record.mode !== 'write' || record.completedAt === undefined || record.identity === undefined) {
      throw new ExtensionMediaHandleError('handle_consumed', 'Output handle is not completed')
    }
    return {
      handleId,
      absolutePath: record.absolutePath,
      completedIdentity: record.identity
    }
  }

  /**
   * Finalizes provisional handles after a completed durable job is recovered.
   * Already-finalized handles are ignored so the operation is restart-safe.
   */
  async commitOutputTransaction(
    principal: ExtensionPrincipal,
    handleIds: readonly string[],
    reservationId: string
  ): Promise<void> {
    if (handleIds.length < 1 || handleIds.length > 16 ||
      new Set(handleIds).size !== handleIds.length) {
      throw new ExtensionMediaHandleError('handle_reserved', 'Output commit set is invalid')
    }
    await this.store.update(emptyDocument, (document) => {
      const handles = { ...document.handles }
      let changed = false
      for (const handleId of handleIds) {
        const record = handles[handleId]
        if (record === undefined) continue
        assertOwnedRecordIncludingRevoked(record, principal)
        if (record.reservationId !== reservationId) continue
        if (record.mode !== 'write' || record.completedAt === undefined || record.identity === undefined) {
          throw new ExtensionMediaHandleError(
            'handle_consumed',
            'Output transaction is not completed'
          )
        }
        const generated = Object.values(handles).filter((candidate) =>
          candidate.ownerExtensionId === principal.extensionId &&
          candidate.ownerExtensionVersion === principal.extensionVersion &&
          candidate.source === 'generated' &&
          candidate.mode === 'read' &&
          candidate.reservationId === reservationId &&
          candidate.absolutePath === record.absolutePath &&
          candidate.identity !== undefined && matchesFileIdentity(candidate.identity, record.identity!)
        )
        if (generated.length !== 1) {
          throw new ExtensionMediaHandleError(
            'handle_consumed',
            'Provisional generated handle set changed before recovery commit'
          )
        }
        const finalizedOriginal = { ...record }
        const finalizedGenerated = { ...generated[0]! }
        delete finalizedOriginal.reservationId
        delete finalizedOriginal.previousIdentity
        delete finalizedGenerated.reservationId
        handles[handleId] = finalizedOriginal
        handles[generated[0]!.id] = finalizedGenerated
        changed = true
      }
      if (!changed) return document
      return {
        ...document,
        revision: document.revision + 1,
        handles
      }
    })
  }

  /**
   * Restores persisted handle state for a reservation after its filesystem
   * targets have been rolled back. This also removes any provisional generated
   * read handles created before the durable job terminal fence.
   */
  async rollbackOutputTransaction(
    principal: ExtensionPrincipal,
    handleIds: readonly string[],
    reservationId: string
  ): Promise<void> {
    if (handleIds.length < 1 || handleIds.length > 16 ||
      new Set(handleIds).size !== handleIds.length) {
      throw new ExtensionMediaHandleError('handle_reserved', 'Output rollback set is invalid')
    }
    await this.store.update(emptyDocument, (document) => {
      const handles = { ...document.handles }
      let changed = false
      for (const handleId of handleIds) {
        const record = handles[handleId]
        if (record === undefined) continue
        assertOwnedTransactionRecord(record, principal)
        if (record.reservationId !== reservationId) continue
        if (record.mode !== 'write') throw new ExtensionMediaHandleError(
          'handle_reserved',
          'Output transaction changed before recovery'
        )
        if (record.completedAt === undefined) {
          const restored = { ...record }
          delete restored.reservationId
          handles[handleId] = restored
          changed = true
          continue
        }
        const generated = Object.values(handles).filter((candidate) =>
          candidate.ownerExtensionId === principal.extensionId &&
          candidate.ownerExtensionVersion === principal.extensionVersion &&
          candidate.source === 'generated' &&
          candidate.mode === 'read' &&
          candidate.reservationId === reservationId &&
          candidate.absolutePath === record.absolutePath
        )
        if (generated.length !== 1) {
          throw new ExtensionMediaHandleError(
            'handle_consumed',
            'Provisional generated handle set changed before recovery'
          )
        }
        const restored = { ...record }
        if (record.previousIdentity) restored.identity = record.previousIdentity
        else delete restored.identity
        delete restored.previousIdentity
        delete restored.reservationId
        delete restored.completedAt
        delete restored.revokedAt
        handles[handleId] = restored
        delete handles[generated[0]!.id]
        changed = true
      }
      if (!changed) return document
      return {
        ...document,
        revision: document.revision + 1,
        handles
      }
    })
  }

  async revokeExtension(extensionId: string): Promise<number> {
    let count = 0
    const cachePaths = new Set<string>()
    await this.store.update(emptyDocument, (document) => {
      const revokedAt = this.now().toISOString()
      const handles = Object.fromEntries(Object.entries(document.handles).map(([id, record]) => {
        if (record.ownerExtensionId !== extensionId || record.revokedAt) return [id, record]
        count += 1
        if (record.lifecycle === 'cache') cachePaths.add(record.absolutePath)
        return [id, { ...record, revokedAt }]
      }))
      return count === 0 ? document : { ...document, revision: document.revision + 1, handles }
    })
    await deleteCachePaths(cachePaths)
    return count
  }

  /** Revoke handles owned by one extension in one workspace, leaving peers intact. */
  async revokeExtensionWorkspace(
    extensionId: string,
    workspaceId: string,
    workspaceRoot?: string
  ): Promise<number> {
    const canonicalWorkspace = workspaceRoot === undefined
      ? undefined
      : await canonicalExistingDirectory(workspaceRoot)
    let count = 0
    const cachePaths = new Set<string>()
    await this.store.update(emptyDocument, (document) => {
      const revokedAt = this.now().toISOString()
      const handles = Object.fromEntries(Object.entries(document.handles).map(([id, record]) => {
        if (
          record.ownerExtensionId !== extensionId ||
          (
            extensionWorkspaceKey(record.workspaceRoot) !== workspaceId &&
            record.workspaceRoot !== canonicalWorkspace
          ) ||
          record.revokedAt
        ) return [id, record]
        count += 1
        if (record.lifecycle === 'cache') cachePaths.add(record.absolutePath)
        return [id, { ...record, revokedAt }]
      }))
      return count === 0 ? document : { ...document, revision: document.revision + 1, handles }
    })
    await deleteCachePaths(cachePaths)
    return count
  }

  async revokeWorkspace(workspaceRoot: string): Promise<number> {
    const canonical = await canonicalExistingDirectory(workspaceRoot)
    let count = 0
    const cachePaths = new Set<string>()
    await this.store.update(emptyDocument, (document) => {
      const revokedAt = this.now().toISOString()
      const handles = Object.fromEntries(Object.entries(document.handles).map(([id, record]) => {
        if (record.workspaceRoot !== canonical || record.revokedAt) return [id, record]
        count += 1
        if (record.lifecycle === 'cache') cachePaths.add(record.absolutePath)
        return [id, { ...record, revokedAt }]
      }))
      return count === 0 ? document : { ...document, revision: document.revision + 1, handles }
    })
    await deleteCachePaths(cachePaths)
    return count
  }

  async list(principal: ExtensionPrincipal, workspaceRoot?: string): Promise<MediaHandleProjection[]> {
    const workspace = workspaceRoot ? await authorizeWorkspace(principal, workspaceRoot) : undefined
    const document = await this.store.read(emptyDocument)
    return Object.values(document.handles)
      .filter((record) => record.ownerExtensionId === principal.extensionId)
      .filter((record) => record.ownerExtensionVersion === principal.extensionVersion)
      .filter((record) => !workspace || record.workspaceRoot === workspace)
      .map(project)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
  }

  private async requireOwned(
    principal: ExtensionPrincipal,
    handleId: string
  ): Promise<StoredMediaHandle> {
    const record = (await this.store.read(emptyDocument)).handles[handleId]
    if (!record || record.revokedAt || record.ownerExtensionId !== principal.extensionId ||
      record.ownerExtensionVersion !== principal.extensionVersion) {
      throw new ExtensionMediaHandleError('not_found', 'Media handle is not available')
    }
    return record
  }
}

async function resolveCandidate(
  input: RegisterMediaHandleInput & { workspaceRoot: string }
): Promise<{ absolutePath: string; identity?: FileIdentity }> {
  if (!isAbsolute(input.path)) {
    const candidate = resolve(input.workspaceRoot, input.path)
    await assertWithinWorkspace(input.workspaceRoot, candidate, input.mode === 'write')
    return input.mode === 'read'
      ? { absolutePath: await realpath(candidate), identity: await readIdentity(candidate) }
      : await outputCandidate(candidate)
  }
  if (input.source !== 'picker') {
    throw new ExtensionMediaHandleError('path_escape', 'Absolute media paths require a protected picker grant')
  }
  if (input.mode === 'read') {
    const absolutePath = await realpath(input.path)
    return { absolutePath, identity: await readIdentity(absolutePath) }
  }
  return await outputCandidate(input.path)
}

async function outputCandidate(path: string): Promise<{ absolutePath: string; identity?: FileIdentity }> {
  const absolutePath = await canonicalOutput(path)
  try {
    return { absolutePath, identity: await readIdentity(absolutePath) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { absolutePath }
    throw error
  }
}

async function authorizeWorkspace(
  principal: ExtensionPrincipal,
  workspaceRoot: string
): Promise<string> {
  if (!principal.workspaceTrusted) {
    throw new ExtensionMediaHandleError('workspace_untrusted', 'Workspace is not trusted')
  }
  const canonical = await canonicalExistingDirectory(workspaceRoot)
  const authorized = await Promise.all(principal.workspaceRoots.map(async (root) => {
    try {
      return await canonicalExistingDirectory(root)
    } catch {
      return ''
    }
  }))
  if (!authorized.includes(canonical)) {
    throw new ExtensionMediaHandleError('workspace_denied', 'Workspace is not authorized')
  }
  return canonical
}

function assertExtensionCacheTarget(
  principal: ExtensionPrincipal,
  workspaceRoot: string,
  path: string
): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(principal.extensionId) ||
    isAbsolute(path)
  ) {
    throw new ExtensionMediaHandleError('path_escape', 'Invalid Host-owned extension cache target')
  }
  const cacheRoot = resolve(workspaceRoot, '.kun', 'extension-cache', principal.extensionId)
  const candidate = resolve(workspaceRoot, path)
  const rel = relative(cacheRoot, candidate)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ExtensionMediaHandleError(
      'path_escape',
      'Cache target must remain inside the owning extension cache'
    )
  }
  return candidate
}

async function ensureCacheParent(workspaceRoot: string, target: string): Promise<void> {
  const parentRelative = relative(workspaceRoot, dirname(target))
  if (
    parentRelative === '' || parentRelative === '..' ||
    parentRelative.startsWith(`..${sep}`) || isAbsolute(parentRelative)
  ) {
    throw new ExtensionMediaHandleError('path_escape', 'Cache parent escapes the workspace')
  }
  let current = workspaceRoot
  for (const segment of parentRelative.split(sep).filter(Boolean)) {
    current = join(current, segment)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new ExtensionMediaHandleError(
          'path_escape',
          'Host-owned cache directories cannot contain links or non-directories'
        )
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirError
      }
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new ExtensionMediaHandleError(
          'path_escape',
          'Host-owned cache directories cannot contain links or non-directories'
        )
      }
    }
  }
}

function requirePermission(principal: ExtensionPrincipal, permission: string): void {
  if (!principal.permissions.includes(permission)) {
    throw new ExtensionMediaHandleError('permission_denied', `Missing permission: ${permission}`)
  }
}

function requireRecordAccess(
  principal: ExtensionPrincipal,
  record: StoredMediaHandle,
  mode: MediaHandleMode
): void {
  if (mode === 'write' && record.lifecycle === 'cache') {
    requirePermission(principal, 'media.process')
    requirePermission(principal, 'workspace.write')
    return
  }
  requirePermission(principal, mode === 'read' ? 'media.read' : 'media.export')
  requirePermission(principal, mode === 'read' ? 'workspace.read' : 'workspace.write')
}

async function canonicalExistingDirectory(path: string): Promise<string> {
  const canonical = await realpath(resolve(path))
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new ExtensionMediaHandleError('not_regular_file', 'Workspace is not a directory')
  return canonical
}

async function assertWithinWorkspace(root: string, candidate: string, output: boolean): Promise<void> {
  const canonicalRoot = await canonicalExistingDirectory(root)
  const canonicalCandidate = output ? await canonicalOutput(candidate) : await realpath(candidate)
  const rel = relative(canonicalRoot, canonicalCandidate)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ExtensionMediaHandleError('path_escape', 'Media path escapes the workspace')
  }
}

async function canonicalOutput(path: string): Promise<string> {
  const candidate = resolve(path)
  const parent = await realpath(dirname(candidate))
  const target = resolve(parent, basename(candidate))
  try {
    const linkInfo = await lstat(target)
    if (linkInfo.isSymbolicLink() || !linkInfo.isFile()) {
      throw new ExtensionMediaHandleError('not_regular_file', 'Media output is not a regular file')
    }
    return await realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target
    throw error
  }
}

export function fileIdentityFromStat(info: {
  size: number | bigint
  mtimeMs: number | bigint
  dev: number | bigint
  ino: number | bigint
}): FileIdentity {
  const device = serializableFileSystemIdentifier(info.dev)
  const inode = serializableFileSystemIdentifier(info.ino)
  return {
    size: statNumber(info.size),
    mtimeMs: statNumber(info.mtimeMs),
    ...(device === undefined ? {} : { device }),
    ...(inode === undefined ? {} : { inode })
  }
}

function serializableFileSystemIdentifier(value: number | bigint): number | undefined {
  if (typeof value === 'bigint') {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : undefined
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function statNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}

async function readIdentity(path: string): Promise<FileIdentity> {
  const info = await stat(path)
  if (!info.isFile()) throw new ExtensionMediaHandleError('not_regular_file', 'Media input is not a regular file')
  return fileIdentityFromStat(info)
}

async function refreshIdentity(record: StoredMediaHandle): Promise<StoredMediaHandle> {
  if (record.mode === 'write' && !record.identity) {
    try {
      await lstat(record.absolutePath)
      throw new ExtensionMediaHandleError('file_changed', 'Export target changed after selection')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return record
      throw error
    }
  }
  const current = await readIdentity(record.absolutePath)
  if (record.identity && !matchesFileIdentity(record.identity, current)) {
    throw new ExtensionMediaHandleError('file_changed', 'Media file identity changed')
  }
  return { ...record, identity: current }
}

function assertOwnedRecord(
  record: StoredMediaHandle | undefined,
  principal: ExtensionPrincipal
): asserts record is StoredMediaHandle {
  if (!record || record.revokedAt || record.ownerExtensionId !== principal.extensionId ||
    record.ownerExtensionVersion !== principal.extensionVersion) {
    throw new ExtensionMediaHandleError('not_found', 'Media handle is not available')
  }
}

function assertOwnedTransactionRecord(
  record: StoredMediaHandle | undefined,
  principal: ExtensionPrincipal
): asserts record is StoredMediaHandle {
  if (!record || record.ownerExtensionId !== principal.extensionId ||
    record.ownerExtensionVersion !== principal.extensionVersion ||
    (record.revokedAt !== undefined &&
      !(record.mode === 'write' && record.completedAt !== undefined && record.reservationId))) {
    throw new ExtensionMediaHandleError('not_found', 'Media handle is not available')
  }
}

function assertOwnedRecordIncludingRevoked(
  record: StoredMediaHandle | undefined,
  principal: ExtensionPrincipal
): asserts record is StoredMediaHandle {
  if (!record || record.ownerExtensionId !== principal.extensionId ||
    record.ownerExtensionVersion !== principal.extensionVersion) {
    throw new ExtensionMediaHandleError('not_found', 'Media handle is not available')
  }
}

export function matchesFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs &&
    (left.device === undefined || right.device === undefined || left.device === right.device) &&
    (left.inode === undefined || right.inode === undefined || left.inode === right.inode)
}

export function identifiesSameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.device !== undefined && right.device !== undefined &&
    left.inode !== undefined && right.inode !== undefined &&
    left.device === right.device && left.inode === right.inode
}

function project(record: StoredMediaHandle): MediaHandleProjection {
  const rel = relative(record.workspaceRoot, record.absolutePath)
  const workspaceRelativePath = rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
    ? rel.split(sep).join('/')
    : undefined
  return {
    id: record.id,
    displayName: record.displayName,
    mode: record.mode,
    source: record.source,
    lifecycle: record.lifecycle,
    mimeType: record.mimeType,
    ...(record.identity ? {
      byteSize: record.identity.size,
      modifiedAt: new Date(record.identity.mtimeMs).toISOString(),
      completionIdentity: completionIdentity(record)
    } : {}),
    ...(workspaceRelativePath ? { workspaceRelativePath } : {}),
    available: !record.revokedAt,
    createdAt: record.createdAt,
    lastAccessedAt: record.lastAccessedAt ?? record.createdAt
  }
}

async function deleteCachePaths(paths: ReadonlySet<string>): Promise<void> {
  await Promise.all([...paths].map(async (path) => {
    try {
      await rm(path, { force: true })
    } catch {
      // Revocation is authoritative even if best-effort filesystem cleanup is
      // temporarily blocked; no cache handle remains usable after this point.
    }
  }))
}

function completionIdentity(record: StoredMediaHandle): string {
  const identity = record.identity
  if (!identity) return ''
  return createHash('sha256')
    .update(`${record.id}\0${identity.device ?? ''}\0${identity.inode ?? ''}\0${identity.size}\0${identity.mtimeMs}`)
    .digest('base64url')
}

function boundedDisplayName(value: string): string {
  const normalized = stripAsciiControl(value.trim())
  return (normalized || 'media').slice(0, 256)
}

function stripAsciiControl(value: string): string {
  return [...value].filter((character) => {
    const code = character.charCodeAt(0)
    return code > 31 && code !== 127
  }).join('')
}

function inferMediaMime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.mp4': return 'video/mp4'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.mkv': return 'video/x-matroska'
    case '.mp3': return 'audio/mpeg'
    case '.m4a': return 'audio/mp4'
    case '.wav': return 'audio/wav'
    case '.aac': return 'audio/aac'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.srt': return 'application/x-subrip'
    case '.vtt': return 'text/vtt'
    case '.otio': return 'application/x-otio+json'
    default: return 'application/octet-stream'
  }
}
