import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type {
  GitTurnReapplyConflict,
  GitTurnReapplyRequest,
  GitTurnReapplyResult,
  GitTurnUndoPreflightRequest,
  GitTurnUndoPreflightResult,
  GitTurnUndoRequest,
  GitTurnUndoResult,
  GitTurnUndoStatus,
  GitTurnUndoStatusRequest
} from '../../shared/git-turn-undo'
import { validateCheckpointRestoreContext } from './git-checkpoint-manifest'
import {
  isValidWithinBase,
  readMetadata,
  resolveCheckpointManifest,
  resolveCheckpointsRoot,
  resolvePathWithinRepository,
  type GitCheckpointMetadata,
  type GitCheckpointStorageOptions
} from './git-checkpoint-foundation'
import { readCurrentFile, sha256Hex } from './git-turn-undo-checkpoint-reader'
import { computeTurnUndoPlan } from './git-turn-undo-preflight'
import {
  createTurnUndoId,
  isValidTurnUndoId,
  readTurnUndoLedger,
  turnUndoRedoDir,
  writeTurnUndoRecord,
  type TurnUndoRecord,
  type TurnUndoRecordFile
} from './git-turn-undo-ledger'

export type TurnUndoRuntimeRequest = (
  path: string,
  init: { method?: string; body?: string }
) => Promise<{ ok: boolean; status: number; body: string }>

type ServiceParams = {
  dataDir: string
  storage?: GitCheckpointStorageOptions
  /** When provided, writes are refused while a thread in this repository runs a turn. */
  runtimeRequest?: TurnUndoRuntimeRequest
}

const repositoryLocks = new Map<string, Promise<unknown>>()

async function withRepositoryLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = repositoryLocks.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  repositoryLocks.set(key, run)
  try { return await run } finally { if (repositoryLocks.get(key) === run) repositoryLocks.delete(key) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/**
 * Refuse while a thread whose workspace is in this repository is running a
 * turn: the agent may be editing the very files undo is about to write. A
 * runtime that cannot be queried fails closed.
 */
async function busyMessage(runtimeRequest: TurnUndoRuntimeRequest | undefined, repositoryReal: string): Promise<string | null> {
  if (!runtimeRequest) return null
  try {
    const response = await runtimeRequest('/v1/threads?limit=500&include=side', { method: 'GET' })
    if (!response.ok) return 'Cannot verify runtime state before changing files. Please ensure the runtime is healthy and try again.'
    const data = JSON.parse(response.body) as { threads?: Array<{ status?: string; workspace?: string }> }
    for (const thread of data.threads ?? []) {
      if (thread.status !== 'running') continue
      const workspace = thread.workspace?.trim()
      const workspaceReal = workspace ? await realpath(workspace).catch(() => normalize(workspace)) : ''
      if (!workspaceReal || isWithin(repositoryReal, workspaceReal) || isWithin(workspaceReal, repositoryReal)) {
        return 'Cannot change files while a task in this workspace is running. Wait for the current turn to finish.'
      }
    }
    return null
  } catch (error) {
    return `Cannot verify runtime state before changing files: ${errorMessage(error)}`
  }
}

async function setExecutable(path: string, executable: boolean): Promise<void> {
  const info = await stat(path)
  const isExecutable = (info.mode & 0o111) !== 0
  if (isExecutable === executable) return
  await chmod(path, executable ? info.mode | 0o111 : info.mode & ~0o111)
}

type FileWrite = { absolutePath: string; bytes: Buffer | null; executable: boolean }

async function applyWrite(write: FileWrite): Promise<void> {
  if (!write.bytes) {
    await rm(write.absolutePath, { force: true })
    return
  }
  await mkdir(dirname(write.absolutePath), { recursive: true })
  await writeFile(write.absolutePath, write.bytes)
  await setExecutable(write.absolutePath, write.executable)
}

/** Apply every write or none: on failure the already-written files are put back. */
async function applyWritesAtomically(writes: FileWrite[], rollback: FileWrite[]): Promise<void> {
  const applied: number[] = []
  try {
    for (let index = 0; index < writes.length; index += 1) {
      await applyWrite(writes[index])
      applied.push(index)
    }
  } catch (error) {
    for (const index of applied.reverse()) {
      await applyWrite(rollback[index]).catch(() => undefined)
    }
    throw error
  }
}

export async function preflightTurnUndo(
  params: Omit<ServiceParams, 'runtimeRequest'> & { request: GitTurnUndoPreflightRequest }
): Promise<GitTurnUndoPreflightResult> {
  try {
    const result = await computeTurnUndoPlan(params)
    return result.ok ? { ok: true, preflight: result.plan.preflight } : result
  } catch (error) {
    return { ok: false, reason: 'error', message: errorMessage(error) }
  }
}

export async function undoTurnFiles(params: ServiceParams & { request: GitTurnUndoRequest }): Promise<GitTurnUndoResult> {
  const checkpointsRoot = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const metadata = await readMetadata(checkpointsRoot, params.request.checkpointId.trim())
  const lockKey = metadata ? await realpath(metadata.repositoryRoot).catch(() => metadata.repositoryRoot) : checkpointsRoot
  return withRepositoryLock(lockKey, async () => {
    try {
      const planned = await computeTurnUndoPlan(params)
      if (!planned.ok) return planned
      const { plan } = planned
      const { preflight } = plan
      if (!preflight.canUndo || !plan.metadata) {
        return preflight.unsafe.length > 0
          ? { ok: false, reason: 'unsafe', message: `${preflight.unsafe.length} file(s) cannot be restored safely; nothing was changed.`, preflight }
          : { ok: false, reason: 'nothing_to_undo', message: 'This turn left no file changes to undo.', preflight }
      }
      const busy = await busyMessage(params.runtimeRequest, preflight.repositoryRoot ?? plan.metadata.repositoryRoot)
      if (busy) return { ok: false, reason: 'busy', message: busy }

      const undoId = createTurnUndoId()
      const redoDir = turnUndoRedoDir(checkpointsRoot, plan.metadata.checkpointId, undoId)
      const writes: FileWrite[] = []
      const rollback: FileWrite[] = []
      const files: TurnUndoRecordFile[] = []
      for (const entry of plan.entries) {
        // Re-read under the lock: the bytes saved for Reapply must be the
        // exact end state the preflight verified.
        const current = await readCurrentFile(entry.absolutePath)
        if (!current || current.sha256 !== entry.currentSha256) {
          await rm(redoDir, { recursive: true, force: true }).catch(() => undefined)
          return { ok: false, reason: 'unsafe', message: `${entry.path} changed while undo was running; nothing was changed.`, preflight }
        }
        const redoPath = join(redoDir, entry.path)
        await mkdir(dirname(redoPath), { recursive: true })
        await writeFile(redoPath, current.bytes)
        writes.push({
          absolutePath: entry.absolutePath,
          bytes: entry.before?.bytes ?? null,
          executable: entry.before?.executable ?? false
        })
        rollback.push({ absolutePath: entry.absolutePath, bytes: current.bytes, executable: current.executable })
        files.push({
          path: entry.path,
          action: entry.action,
          endSha256: current.sha256,
          endExecutable: current.executable,
          restoredSha256: entry.before ? sha256Hex(entry.before.bytes) : null
        })
      }
      const now = new Date().toISOString()
      const record: TurnUndoRecord = {
        version: 1,
        undoId,
        checkpointId: plan.metadata.checkpointId,
        threadId: plan.metadata.threadId,
        scope: params.request.scope ?? 'turn',
        state: 'pending',
        createdAt: now,
        updatedAt: now,
        files
      }
      await writeTurnUndoRecord(checkpointsRoot, record)
      try {
        await applyWritesAtomically(writes, rollback)
      } catch (error) {
        await writeTurnUndoRecord(checkpointsRoot, { ...record, state: 'failed', updatedAt: new Date().toISOString() }).catch(() => undefined)
        return { ok: false, reason: 'error', message: `Undo failed and was rolled back: ${errorMessage(error)}` }
      }
      await writeTurnUndoRecord(checkpointsRoot, { ...record, state: 'undone', updatedAt: new Date().toISOString() })
      return {
        ok: true,
        undoId,
        restored: files.filter((file) => file.action === 'restore').map((file) => file.path),
        deleted: files.filter((file) => file.action === 'delete').map((file) => file.path),
        preflight
      }
    } catch (error) {
      return { ok: false, reason: 'error', message: errorMessage(error) }
    }
  })
}

async function validateTarget(
  checkpointsRoot: string,
  metadata: GitCheckpointMetadata,
  request: GitTurnReapplyRequest
): Promise<string | null> {
  const expectedThreadId = request.expectedThreadId?.trim()
  const expectedWorkspaceRoot = request.expectedWorkspaceRoot?.trim()
  if (!expectedThreadId && !expectedWorkspaceRoot) return null
  const { manifest, hasWorkspaceIdentity } = await resolveCheckpointManifest(checkpointsRoot, metadata)
  const validation = await validateCheckpointRestoreContext({
    manifest,
    expected: {
      ...(expectedThreadId ? { expectedThreadId } : {}),
      ...(hasWorkspaceIdentity && expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
    }
  })
  return validation.ok ? null : validation.message
}

export async function reapplyTurnFiles(params: ServiceParams & { request: GitTurnReapplyRequest }): Promise<GitTurnReapplyResult> {
  const { request } = params
  const checkpointsRoot = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const checkpointId = request.checkpointId.trim()
  const undoId = request.undoId.trim()
  const metadata = await readMetadata(checkpointsRoot, checkpointId)
  if (!metadata || !isValidTurnUndoId(undoId)) {
    return { ok: false, reason: 'not_found', message: 'The undo snapshot for this turn is no longer available.' }
  }
  const repositoryReal = await realpath(metadata.repositoryRoot).catch(() => null)
  if (!repositoryReal) {
    return { ok: false, reason: 'no_workspace', message: `The checkpoint's repository no longer exists: ${metadata.repositoryRoot}` }
  }
  return withRepositoryLock(repositoryReal, async () => {
    try {
      const mismatch = await validateTarget(checkpointsRoot, metadata, request)
      if (mismatch) return { ok: false, reason: 'error', message: mismatch }
      const record = (await readTurnUndoLedger(checkpointsRoot, checkpointId))
        .find((candidate) => candidate.undoId === undoId && candidate.state === 'undone')
      if (!record) {
        return { ok: false, reason: 'not_found', message: 'The undo snapshot for this turn is no longer available.' }
      }
      const redoDir = await realpath(turnUndoRedoDir(checkpointsRoot, checkpointId, undoId)).catch(() => null)
      const conflicts: GitTurnReapplyConflict[] = []
      const writes: FileWrite[] = []
      const rollback: FileWrite[] = []
      for (const file of record.files) {
        let absolutePath: string
        let current: Awaited<ReturnType<typeof readCurrentFile>>
        try {
          absolutePath = await resolvePathWithinRepository(metadata.repositoryRoot, file.path)
          current = await readCurrentFile(absolutePath)
        } catch {
          conflicts.push({ path: file.path, reason: 'unreadable' })
          continue
        }
        if ((current?.sha256 ?? null) !== file.restoredSha256) {
          conflicts.push({ path: file.path, reason: 'modified_after_undo' })
          continue
        }
        const endBytes = redoDir && isValidWithinBase(file.path, redoDir)
          ? await readFile(normalize(join(redoDir, file.path))).catch(() => null)
          : null
        if (!endBytes || sha256Hex(endBytes) !== file.endSha256) {
          conflicts.push({ path: file.path, reason: 'snapshot_missing' })
          continue
        }
        writes.push({ absolutePath, bytes: endBytes, executable: file.endExecutable })
        rollback.push({ absolutePath, bytes: current?.bytes ?? null, executable: current?.executable ?? false })
      }
      if (conflicts.length > 0) {
        return {
          ok: false,
          reason: 'unsafe',
          message: `${conflicts.length} file(s) changed after the undo; nothing was changed.`,
          conflicts
        }
      }
      const busy = await busyMessage(params.runtimeRequest, repositoryReal)
      if (busy) return { ok: false, reason: 'busy', message: busy }
      try {
        await applyWritesAtomically(writes, rollback)
      } catch (error) {
        return { ok: false, reason: 'error', message: `Reapply failed and was rolled back: ${errorMessage(error)}` }
      }
      await writeTurnUndoRecord(checkpointsRoot, { ...record, state: 'reapplied', updatedAt: new Date().toISOString() })
      return {
        ok: true,
        restored: record.files.filter((file) => file.action === 'restore').map((file) => file.path),
        deleted: record.files.filter((file) => file.action === 'delete').map((file) => file.path)
      }
    } catch (error) {
      return { ok: false, reason: 'error', message: errorMessage(error) }
    }
  })
}

export async function getTurnUndoStatus(params: {
  dataDir: string
  storage?: GitCheckpointStorageOptions
  request: GitTurnUndoStatusRequest
}): Promise<GitTurnUndoStatus> {
  const checkpointsRoot = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const records = await readTurnUndoLedger(checkpointsRoot, params.request.checkpointId.trim())
  const latest = [...records].reverse().find((record) => record.scope === 'turn' && record.state !== 'pending' && record.state !== 'failed')
  if (!latest || latest.state !== 'undone') return { state: 'none' }
  return { state: 'undone', undoId: latest.undoId, undoneAt: latest.updatedAt, fileCount: latest.files.length }
}
