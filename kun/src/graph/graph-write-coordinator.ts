import { mkdir, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { ArtifactStore } from '../artifacts/artifact-store.js'
import type { GraphRuntimeConfig } from '../config/kun-config.js'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import { AtomicJsonFile } from '../extensions/atomic-json.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'
import {
  assertGraphWriteFence,
  boundedGraphError as boundedError,
  canonicalGraphPath as canonicalPath,
  graphCommitGit,
  graphGit as git,
  graphWriteMutexContext,
  normalizeGraphScopes as normalizeScopes,
  safeGraphId as safeId,
  workingTreeChangedFiles,
  workspaceChangeSnapshot,
  withGraphWriteCommit
} from './graph-write-coordinator-side-effects.js'
import {
  GraphRelativePathSchema,
  graphRelativePathsOverlap
} from '../contracts/graph-path.js'
import {
  graphHostRelativePathCovers,
  graphHostRelativePathsOverlap,
  graphPhysicalPathsEqual,
  isGraphPhysicalPathContained
} from './graph-platform-path.js'

const Timestamp = z.string().datetime({ offset: true })
const Identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
const RelativePath = GraphRelativePathSchema

const PathLeaseSchema = z.object({
  leaseId: Identifier,
  runId: Identifier,
  nodeId: Identifier,
  attemptId: Identifier,
  workspaceRoot: z.string().min(1).max(4_096),
  scopes: z.array(RelativePath).max(1_000),
  baselineChanges: z.record(z.string(), z.string()).optional(),
  baselineError: z.string().max(2_048).optional(),
  state: z.enum(['active', 'released', 'expired', 'orphaned']),
  acquiredAt: Timestamp,
  expiresAt: Timestamp,
  releasedAt: Timestamp.optional(),
  // Optional for backward compatibility with pre-disposition write state.
  releaseDisposition: z.enum(['accepted', 'failed', 'cancelled']).optional()
}).strict()
export type GraphPathLease = z.infer<typeof PathLeaseSchema>

const WorktreeRecordSchema = z.object({
  worktreeId: Identifier,
  runId: Identifier,
  nodeId: Identifier,
  attemptId: Identifier,
  repositoryRoot: z.string().min(1).max(4_096),
  path: z.string().min(1).max(4_096),
  baseRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
  headRevision: z.string().regex(/^[a-f0-9]{40,64}$/),
  state: z.enum(['active', 'accepted', 'conflict', 'preserved', 'cleaned', 'orphaned']),
  changedFiles: z.array(RelativePath).max(10_000),
  patchArtifactId: z.string().optional(),
  lastError: z.string().max(2_048).optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp
}).strict()
export type GraphWorktreeRecord = z.infer<typeof WorktreeRecordSchema>

const WriteStateSchema = z.object({
  leases: z.array(PathLeaseSchema).max(100_000),
  worktrees: z.array(WorktreeRecordSchema).max(100_000)
}).strict()
type WriteState = z.infer<typeof WriteStateSchema>

export type GraphWriteClaimResult =
  | { acquired: true; lease: GraphPathLease; workspaceRoot: string; worktree?: GraphWorktreeRecord }
  | { acquired: false; conflicts: GraphPathLease[] }

export type GraphChangedFilesObservation =
  | { status: 'observed'; changedFiles: string[] }
  | { status: 'unavailable'; error: string }
export type GraphResourceCleanupResult = {
  resourceKind: 'lease' | 'worktree'
  resourceId: string
  attemptId?: string
  state: 'completed' | 'failed' | 'preserved'
  lastError?: string
}

export class FileGraphWriteCoordinator {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly stateFile: AtomicJsonFile<WriteState>
  private readonly nowIso: () => string
  private readonly nextId: (prefix: string) => string

  constructor(private readonly options: {
    rootDir: string
    config: () => GraphRuntimeConfig
    artifactStore?: ArtifactStore
    nowIso?: () => string
    nextId?: (prefix: string) => string
  }) {
    this.stateFile = new AtomicJsonFile(this.statePath(), (value) => WriteStateSchema.parse(value))
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    let next = 0
    this.nextId = options.nextId ?? ((prefix) => `${prefix}_${Date.now()}_${++next}`)
  }

  acquire(input: {
    runId: string
    nodeId: string
    attemptId: string
    workspaceRoot: string
    scopes: readonly string[]
  }): Promise<GraphWriteClaimResult> {
    return this.enqueue(async () => {
      const state = await this.load()
      this.expireLeasesInState(state)
      const workspaceRoot = await canonicalPath(input.workspaceRoot)
      const scopes = normalizeScopes(input.scopes)
      const isolation = this.options.config().writeIsolation
      const conflicts = state.leases.filter((lease) =>
        lease.state === 'active' &&
        graphPhysicalPathsEqual(lease.workspaceRoot, workspaceRoot) &&
        lease.attemptId !== input.attemptId &&
        writeClaimsConflict(
          isolation.mode,
          isolation.allowWorktrees,
          lease.scopes,
          scopes
        ))
      if (conflicts.length) {
        await this.persist(state)
        return { acquired: false, conflicts }
      }
      const now = this.nowIso()
      const useWorktree =
        scopes.length > 0 &&
        isolation.mode === 'worktree' &&
        isolation.allowWorktrees
      let baselineChanges: Record<string, string> | undefined
      let baselineError: string | undefined
      if (scopes.length > 0 && !useWorktree) {
        try {
          baselineChanges = await workspaceChangeSnapshot(workspaceRoot)
        } catch (error) {
          baselineError = boundedError(error)
        }
      }
      const lease = PathLeaseSchema.parse({
        leaseId: this.nextId('graph_lease'),
        runId: input.runId,
        nodeId: input.nodeId,
        attemptId: input.attemptId,
        workspaceRoot,
        scopes,
        ...(baselineChanges ? { baselineChanges } : {}),
        ...(baselineError ? { baselineError } : {}),
        state: 'active',
        acquiredAt: now,
        expiresAt: new Date(
          Date.parse(now) + this.options.config().writeIsolation.leaseTtlMs
        ).toISOString()
      })
      state.leases.push(lease)
      let worktree: GraphWorktreeRecord | undefined
      let effectiveWorkspace = workspaceRoot
      if (useWorktree) {
        worktree = await this.createWorktree(input, workspaceRoot)
        state.worktrees.push(worktree)
        effectiveWorkspace = worktree.path
      }
      await this.persist(state)
      return {
        acquired: true,
        lease,
        workspaceRoot: effectiveWorkspace,
        ...(worktree ? { worktree } : {})
      }
    })
  }

  release(
    leaseId: string,
    disposition: 'accepted' | 'failed' | 'cancelled'
  ): Promise<GraphPathLease> {
    return this.enqueue(async () => {
      const state = await this.load()
      const lease = state.leases.find((entry) => entry.leaseId === leaseId)
      if (!lease) throw new Error(`Graph path lease not found: ${leaseId}`)
      const releasedNow = lease.state === 'active'
      if (releasedNow) {
        lease.state = 'released'
        lease.releasedAt = this.nowIso()
        lease.releaseDisposition = disposition
      }
      const worktree = state.worktrees.find((entry) => entry.attemptId === lease.attemptId)
      if (worktree && releasedNow) {
        if (
          disposition !== 'accepted' &&
          this.options.config().writeIsolation.preserveFailedWorktrees
        ) {
          worktree.state = 'preserved'
          worktree.updatedAt = this.nowIso()
        } else if (disposition === 'accepted') {
          worktree.state = 'accepted'
          worktree.updatedAt = this.nowIso()
        }
      }
      await this.persist(state)
      return lease
    })
  }

  renew(leaseId: string): Promise<GraphPathLease> {
    return this.enqueue(async () => {
      const state = await this.load()
      const lease = state.leases.find((entry) => entry.leaseId === leaseId)
      if (!lease) throw new Error(`Graph path lease not found: ${leaseId}`)
      if (lease.state !== 'active') return PathLeaseSchema.parse(lease)
      const now = this.nowIso()
      if (Date.parse(lease.expiresAt) <= Date.parse(now)) {
        lease.state = 'expired'
        await this.persist(state)
        throw new Error(`Graph path lease expired before renewal: ${leaseId}`)
      }
      lease.expiresAt = new Date(
        Date.parse(now) + this.options.config().writeIsolation.leaseTtlMs
      ).toISOString()
      await this.persist(state)
      return PathLeaseSchema.parse(lease)
    })
  }

  isActive(leaseId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const state = await this.load()
      this.expireLeasesInState(state)
      const active = state.leases.some((entry) =>
        entry.leaseId === leaseId && entry.state === 'active')
      await this.persist(state)
      return active
    })
  }

  rollback(leaseId: string): Promise<void> {
    return this.enqueue(async () => {
      const state = await this.load()
      const lease = state.leases.find((entry) => entry.leaseId === leaseId)
      if (!lease) return
      if (lease.state === 'active') {
        lease.state = 'released'
        lease.releasedAt = this.nowIso()
        lease.releaseDisposition = 'cancelled'
      }
      const worktree = state.worktrees.find((entry) => entry.attemptId === lease.attemptId)
      if (worktree && worktree.state === 'active') {
        await assertGraphWriteFence()
        await graphCommitGit(
          worktree.repositoryRoot, ['worktree', 'remove', '--force', worktree.path]
        )
          .catch((error) => {
            worktree.state = 'orphaned'
            worktree.lastError = boundedError(error)
          })
        if (worktree.state === 'active') worktree.state = 'cleaned'
        worktree.updatedAt = this.nowIso()
      }
      await this.persist(state)
    })
  }

  async captureWorktree(attemptId: string): Promise<GraphWorktreeRecord | null> {
    return this.enqueue(async () => {
      const state = await this.load()
      const record = state.worktrees.find((entry) => entry.attemptId === attemptId)
      if (!record) return null
      await assertGraphWriteFence()
      await graphCommitGit(record.path, ['add', '-A'])
      const [head, files, patch] = await Promise.all([
        git(record.path, ['rev-parse', 'HEAD']),
        git(record.path, ['diff', '--cached', '-z', '--name-only', '--no-renames', record.baseRevision]),
        git(record.path, ['diff', '--cached', '--binary', '--no-ext-diff', record.baseRevision])
      ])
      record.headRevision = head.trim()
      record.changedFiles = normalizeScopes(files.split('\0').filter(Boolean))
      const scopeError = this.scopeViolation(state, record)
      if (scopeError) {
        record.state = 'conflict'
        record.lastError = scopeError
        record.updatedAt = this.nowIso()
        await this.persist(state)
        return WorktreeRecordSchema.parse(record)
      }
      if (patch && this.options.artifactStore) {
        const stored = await this.options.artifactStore.put({
          content: patch,
          mimeType: 'text/x-diff',
          source: 'other',
          origin: `graph-worktree:${attemptId}`,
          maxInlineChars: 2_048
        })
        record.patchArtifactId = stored.meta.id
      }
      record.updatedAt = this.nowIso()
      await this.persist(state)
      return WorktreeRecordSchema.parse(record)
    })
  }

  async captureChangedFiles(attemptId: string): Promise<GraphChangedFilesObservation> {
    const state = await this.load()
    if (state.worktrees.some((entry) => entry.attemptId === attemptId)) {
      const record = await this.captureWorktree(attemptId)
      return record
        ? { status: 'observed', changedFiles: record.changedFiles }
        : { status: 'unavailable', error: 'Graph worktree disappeared during result capture.' }
    }
    const lease = state.leases.find((entry) => entry.attemptId === attemptId)
    if (!lease) return { status: 'unavailable', error: 'Graph write lease is missing.' }
    if (!lease.scopes.length) return { status: 'observed', changedFiles: [] }
    if (lease.baselineError) return { status: 'unavailable', error: lease.baselineError }
    if (!lease.baselineChanges) return {
      status: 'unavailable', error: 'Graph write baseline snapshot is missing.'
    }
    const current = await workspaceChangeSnapshot(lease.workspaceRoot)
    const paths = new Set([
      ...Object.keys(lease.baselineChanges),
      ...Object.keys(current)
    ])
    return {
      status: 'observed',
      changedFiles: normalizeScopes([...paths].filter((path) =>
        lease.baselineChanges?.[path] !== current[path]))
    }
  }

  async integrate(attemptId: string): Promise<{
    outcome: 'applied' | 'conflict' | 'needs_human'
    record: GraphWorktreeRecord
    reason?: string
  }> {
    return this.enqueue(async () => {
      const state = await this.load()
      const record = state.worktrees.find((entry) => entry.attemptId === attemptId)
      if (!record) throw new Error(`Graph worktree not found for attempt ${attemptId}`)
      if (record.state === 'accepted' || record.state === 'cleaned') {
        return { outcome: 'applied', record }
      }
      await assertGraphWriteFence()
      await graphCommitGit(record.path, ['add', '-A'])
      record.changedFiles = normalizeScopes((await git(record.path, [
        'diff',
        '--cached',
        '-z',
        '--name-only',
        '--no-renames',
        record.baseRevision
      ])).split('\0').filter(Boolean))
      const scopeError = this.scopeViolation(state, record)
      if (scopeError) {
        record.state = 'conflict'
        record.lastError = scopeError
        record.updatedAt = this.nowIso()
        await this.persist(state)
        return { outcome: 'needs_human', record, reason: scopeError }
      }
      const currentHead = (await git(record.repositoryRoot, ['rev-parse', 'HEAD'])).trim()
      if (currentHead !== record.baseRevision) {
        record.state = 'conflict'
        record.lastError = 'repository HEAD changed since worktree allocation'
        record.updatedAt = this.nowIso()
        await this.persist(state)
        return { outcome: 'needs_human', record, reason: record.lastError }
      }
      const graphOwned = new Set(state.worktrees
        .filter((entry) =>
          entry.worktreeId !== record.worktreeId &&
          (entry.state === 'accepted' || entry.state === 'cleaned'))
        .flatMap((entry) => entry.changedFiles))
      const overlappingDirty = (await workingTreeChangedFiles(record.repositoryRoot))
        .filter((path) => !graphOwned.has(path) && scopesOverlap([path], record.changedFiles))
      if (overlappingDirty.length) {
        record.state = 'conflict'
        record.lastError =
          `repository contains uncommitted changes overlapping Graph patch: ${overlappingDirty.slice(0, 20).join(', ')}`
        record.updatedAt = this.nowIso()
        await this.persist(state)
        return { outcome: 'needs_human', record, reason: record.lastError }
      }
      const patch = await git(record.path, [
        'diff',
        '--cached',
        '--binary',
        '--no-ext-diff',
        record.baseRevision
      ])
      if (!patch.trim()) {
        record.state = 'accepted'
        record.updatedAt = this.nowIso()
        await this.persist(state)
        return { outcome: 'applied', record }
      }
      const patchPath = join(
        this.options.rootDir,
        'patches',
        `${safeId(record.worktreeId)}-${safeId(this.nextId('commit'))}.patch`
      )
      return withGraphWriteCommit(async (context) => {
        await mkdir(dirname(patchPath), { recursive: true, mode: 0o700 })
        await atomicWriteFile(patchPath, patch, { signal: context.signal })
        try {
          await git(record.repositoryRoot, ['apply', '--check', patchPath])
          await graphCommitGit(record.repositoryRoot, ['apply', '--index', patchPath])
          record.state = 'accepted'
          record.updatedAt = this.nowIso()
          await this.persist(state)
          return { outcome: 'applied' as const, record }
        } catch (error) {
          record.state = 'conflict'
          record.lastError = boundedError(error)
          record.updatedAt = this.nowIso()
          await this.persist(state)
          return { outcome: 'conflict' as const, record, reason: record.lastError }
        } finally {
          await rm(patchPath, { force: true }).catch(() => undefined)
        }
      })
    })
  }

  cleanup(worktreeId: string): Promise<GraphWorktreeRecord> {
    return this.enqueue(async () => {
      const state = await this.load()
      const record = state.worktrees.find((entry) => entry.worktreeId === worktreeId)
      if (!record) throw new Error(`Graph worktree not found: ${worktreeId}`)
      await this.cleanupWorktreeRecord(record)
      await this.persist(state)
      return record
    })
  }

  cleanupRun(runId: string): Promise<GraphResourceCleanupResult[]> {
    return this.enqueue(async () => {
      const state = await this.load()
      const results: GraphResourceCleanupResult[] = []
      for (const lease of state.leases.filter((entry) => entry.runId === runId)) {
        if (lease.state === 'active') {
          lease.state = 'released'
          lease.releasedAt = this.nowIso()
          lease.releaseDisposition = 'cancelled'
        }
        results.push({
          resourceKind: 'lease',
          resourceId: lease.leaseId,
          attemptId: lease.attemptId,
          state: lease.state === 'orphaned' ? 'preserved' : 'completed'
        })
      }
      for (const worktree of state.worktrees.filter((entry) => entry.runId === runId)) {
        try {
          await this.cleanupWorktreeRecord(worktree)
          results.push({
            resourceKind: 'worktree',
            resourceId: worktree.worktreeId,
            attemptId: worktree.attemptId,
            state: worktree.state === 'cleaned' ? 'completed' : 'preserved',
            ...(worktree.lastError ? { lastError: worktree.lastError } : {})
          })
        } catch (error) {
          worktree.lastError = boundedError(error)
          worktree.updatedAt = this.nowIso()
          results.push({
            resourceKind: 'worktree',
            resourceId: worktree.worktreeId,
            attemptId: worktree.attemptId,
            state: 'failed',
            lastError: worktree.lastError
          })
        }
      }
      await this.persist(state)
      return results
    })
  }

  reconcile(
    knownAttemptIds?: ReadonlySet<string>
  ): Promise<{ expiredLeases: number; orphanedWorktrees: number }> {
    return this.enqueue(async () => {
      const state = await this.load()
      const before = state.leases.filter((lease) => lease.state === 'active').length
      this.expireLeasesInState(state)
      const expiredLeases =
        before - state.leases.filter((lease) => lease.state === 'active').length
      if (knownAttemptIds) {
        for (const lease of state.leases) {
          if (lease.state === 'active' && !knownAttemptIds.has(lease.attemptId)) {
            lease.state = 'orphaned'
          }
        }
      }
      let orphanedWorktrees = 0
      for (const worktree of state.worktrees) {
        if (worktree.state !== 'active') continue
        if (knownAttemptIds && !knownAttemptIds.has(worktree.attemptId)) {
          worktree.state = 'orphaned'
          worktree.lastError = 'worktree has no durable Graph attempt after runtime restart'
          worktree.updatedAt = this.nowIso()
          orphanedWorktrees += 1
          continue
        }
        const exists = await realpath(worktree.path).then(() => true).catch(() => false)
        if (!exists) {
          worktree.state = 'orphaned'
          worktree.lastError = 'worktree path is missing after runtime restart'
          worktree.updatedAt = this.nowIso()
          orphanedWorktrees += 1
        }
      }
      await this.persist(state)
      return { expiredLeases, orphanedWorktrees }
    })
  }

  async list(): Promise<WriteState> {
    return this.load()
  }

  private async createWorktree(
    input: { runId: string; nodeId: string; attemptId: string },
    repositoryRoot: string
  ): Promise<GraphWorktreeRecord> {
    const topLevel = (await git(repositoryRoot, ['rev-parse', '--show-toplevel'])).trim()
    const canonicalRepositoryRoot = await canonicalPath(topLevel)
    const baseRevision = (await git(canonicalRepositoryRoot, ['rev-parse', 'HEAD'])).trim()
    const worktreeId = this.nextId('graph_worktree')
    const worktreePath = join(this.worktreeRoot(), safeId(worktreeId))
    await mkdir(this.worktreeRoot(), { recursive: true, mode: 0o700 })
    await assertGraphWriteFence()
    await graphCommitGit(canonicalRepositoryRoot, [
      'worktree',
      'add',
      '--detach',
      worktreePath,
      baseRevision
    ])
    const now = this.nowIso()
    return WorktreeRecordSchema.parse({
      worktreeId,
      runId: input.runId,
      nodeId: input.nodeId,
      attemptId: input.attemptId,
      repositoryRoot: canonicalRepositoryRoot,
      path: worktreePath,
      baseRevision,
      headRevision: baseRevision,
      state: 'active',
      changedFiles: [],
      createdAt: now,
      updatedAt: now
    })
  }

  private expireLeasesInState(state: WriteState): void {
    const now = Date.parse(this.nowIso())
    for (const lease of state.leases) {
      if (lease.state === 'active' && Date.parse(lease.expiresAt) <= now) {
        lease.state = 'expired'
      }
    }
  }

  private scopeViolation(state: WriteState, record: GraphWorktreeRecord): string | undefined {
    const lease = state.leases.find((entry) => entry.attemptId === record.attemptId)
    if (!lease) return `write lease is missing for attempt ${record.attemptId}`
    if (lease.state !== 'active') {
      return `write lease is ${lease.state} for attempt ${record.attemptId}`
    }
    const outside = record.changedFiles.filter((path) =>
      !lease.scopes.some((scope) => graphHostRelativePathCovers(scope, path)))
    return outside.length
      ? `worktree changed files outside its frozen write scope: ${outside.slice(0, 20).join(', ')}`
      : undefined
  }

  private async cleanupWorktreeRecord(record: GraphWorktreeRecord): Promise<void> {
    if (record.state === 'cleaned') return
    if (record.state !== 'accepted') {
      record.state = 'preserved'
      record.lastError ??= 'unaccepted Graph worktree is preserved for explicit human disposition'
      record.updatedAt = this.nowIso()
      return
    }
    const root = await canonicalPath(this.worktreeRoot())
    const candidate = await canonicalPath(record.path)
    if (!isGraphPhysicalPathContained(root, candidate)) {
      throw new Error('refusing to clean worktree outside graph root')
    }
    await assertGraphWriteFence()
    await graphCommitGit(record.repositoryRoot, ['worktree', 'remove', '--force', candidate])
    record.state = 'cleaned'
    record.updatedAt = this.nowIso()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => undefined).then(() =>
      withManagerDataMutex('graph-write-coordinator', (context) =>
        graphWriteMutexContext.run(context, operation)))
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  private async load(): Promise<WriteState> {
    return this.stateFile.read(() => ({ leases: [], worktrees: [] }))
  }

  private async persist(state: WriteState): Promise<void> {
    const context = graphWriteMutexContext.getStore()
    context?.signal.throwIfAborted()
    await context?.assertCurrent()
    context?.signal.throwIfAborted()
    await this.stateFile.write(WriteStateSchema.parse(state), {
      signal: context?.signal,
      fence: context?.fence
    })
  }

  private statePath(): string {
    return join(this.options.rootDir, 'write-coordinator.json')
  }

  private worktreeRoot(): string {
    return join(this.options.rootDir, 'worktrees')
  }
}
export function scopesOverlap(
  left: readonly string[],
  right: readonly string[],
  caseInsensitive?: boolean
): boolean {
  return caseInsensitive === undefined
    ? graphHostRelativePathsOverlap(left, right)
    : graphRelativePathsOverlap(left, right, caseInsensitive)
}
function writeClaimsConflict(
  mode: GraphRuntimeConfig['writeIsolation']['mode'],
  allowWorktrees: boolean,
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (!left.length || !right.length) return false
  if (mode === 'serialize') return true
  if (mode === 'worktree' && allowWorktrees) return false
  return scopesOverlap(left, right)
}
