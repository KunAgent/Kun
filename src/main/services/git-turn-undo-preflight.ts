import { realpath } from 'node:fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'node:path'
import type {
  GitTurnUndoFileInput,
  GitTurnUndoIgnoredFile,
  GitTurnUndoPreflight,
  GitTurnUndoPreflightRequest,
  GitTurnUndoSafeFile,
  GitTurnUndoUnsafeFile
} from '../../shared/git-turn-undo'
import { validateCheckpointRestoreContext } from './git-checkpoint-manifest'
import {
  readMetadata,
  resolveCheckpointManifest,
  resolveCheckpointsRoot,
  resolvePathWithinRepository,
  resolveSymlinkSafe,
  type GitCheckpointMetadata,
  type GitCheckpointStorageOptions
} from './git-checkpoint-foundation'
import {
  openCheckpointFileReader,
  readCurrentFile,
  sha256Hex,
  type CheckpointFileReader
} from './git-turn-undo-checkpoint-reader'
import { listWindowChangedPaths } from './git-turn-undo-window'

/** Shell-changed files listed in a preflight before the rest is summarized as a count. */
export const SHELL_CHANGED_LIST_LIMIT = 50

export type TurnUndoPlanEntry = {
  path: string
  absolutePath: string
  action: 'restore' | 'delete'
  before: { bytes: Buffer; executable: boolean } | null
  currentSha256: string
}

export type TurnUndoPlan = {
  preflight: GitTurnUndoPreflight
  entries: TurnUndoPlanEntry[]
  metadata: GitCheckpointMetadata | null
  checkpointsRoot: string
}

export type TurnUndoPlanResult =
  | { ok: true; plan: TurnUndoPlan }
  | { ok: false; reason: 'no_workspace' | 'error'; message: string }

const SHA256_PATTERN = /^[a-f0-9]{64}$/

function toSlashPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

/** Repository-relative `/` path, or `null` when the input resolves outside it. */
export async function toRepositoryRelativePath(repositoryRootReal: string, inputPath: string): Promise<string | null> {
  const trimmed = inputPath.trim()
  if (!trimmed || trimmed.includes('\0')) return null
  const lexical = isAbsolute(trimmed) ? normalize(trimmed) : normalize(join(repositoryRootReal, trimmed))
  const resolved = await resolveSymlinkSafe(lexical).catch(() => null)
  if (!resolved) return null
  const rel = relative(repositoryRootReal, resolved)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  return toSlashPath(rel)
}

function displayPathOutsideCheckpoint(input: string, workspaceRoot: string | undefined): string {
  if (!workspaceRoot || !isAbsolute(input)) return input
  const rel = relative(workspaceRoot, input)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? toSlashPath(rel) : input
}

/** Last entry per path wins: it carries the latest end state in the range. */
function dedupeInputs(files: GitTurnUndoFileInput[]): GitTurnUndoFileInput[] {
  const byPath = new Map<string, GitTurnUndoFileInput>()
  for (const file of files) {
    const path = file.path.trim()
    if (!path) continue
    byPath.delete(path)
    byPath.set(path, { path, afterSha256: file.afterSha256 })
  }
  return [...byPath.values()]
}

function emptyPreflight(checkpointId: string, repositoryRoot: string | null): GitTurnUndoPreflight {
  return { checkpointId, repositoryRoot, safe: [], unsafe: [], ignored: [], ignoredOverflow: 0, canUndo: false }
}

function finalizePreflight(preflight: GitTurnUndoPreflight): GitTurnUndoPreflight {
  const byPath = (a: { path: string }, b: { path: string }): number => a.path.localeCompare(b.path)
  preflight.safe.sort(byPath)
  preflight.unsafe.sort(byPath)
  const order: Record<GitTurnUndoIgnoredFile['reason'], number> = { no_net_change: 0, end_state_unknown: 1, shell_changed: 2 }
  preflight.ignored.sort((a, b) => order[a.reason] - order[b.reason] || byPath(a, b))
  preflight.canUndo = preflight.safe.length > 0 && preflight.unsafe.length === 0
  return preflight
}

async function openWindowEndReader(
  checkpointsRoot: string,
  startRepositoryReal: string,
  windowEndCheckpointId: string | undefined
): Promise<CheckpointFileReader | null> {
  const endId = windowEndCheckpointId?.trim()
  if (!endId) return null
  const endMetadata = await readMetadata(checkpointsRoot, endId)
  if (!endMetadata) return null
  const endRepositoryReal = await realpath(endMetadata.repositoryRoot).catch(() => null)
  if (endRepositoryReal !== startRepositoryReal) return null
  return openCheckpointFileReader({ checkpointsRoot, metadata: endMetadata })
}

/**
 * Classify every file of a turn range without writing anything. A file is
 * safe only when its current bytes equal the turn's recorded end state and
 * the checkpoint holds its pre-turn content (or proves it did not exist).
 */
export async function computeTurnUndoPlan(params: {
  dataDir: string
  storage?: GitCheckpointStorageOptions
  request: GitTurnUndoPreflightRequest
}): Promise<TurnUndoPlanResult> {
  const { request } = params
  const checkpointId = request.checkpointId.trim()
  const checkpointsRoot = resolveCheckpointsRoot(params.dataDir, params.storage?.checkpointsRoot)
  const inputs = dedupeInputs(request.files)
  const metadata = await readMetadata(checkpointsRoot, checkpointId)
  if (!metadata) {
    const workspaceRoot = request.expectedWorkspaceRoot?.trim()
    const workspaceReal = workspaceRoot ? await realpath(workspaceRoot).catch(() => workspaceRoot) : undefined
    const preflight = emptyPreflight(checkpointId, null)
    preflight.unsafe = inputs.map((input) => ({
      path: displayPathOutsideCheckpoint(input.path, workspaceReal),
      reason: 'checkpoint_missing' as const
    }))
    return { ok: true, plan: { preflight: finalizePreflight(preflight), entries: [], metadata: null, checkpointsRoot } }
  }

  const expectedThreadId = request.expectedThreadId?.trim()
  const expectedWorkspaceRoot = request.expectedWorkspaceRoot?.trim()
  if (expectedThreadId || expectedWorkspaceRoot) {
    const { manifest, hasWorkspaceIdentity } = await resolveCheckpointManifest(checkpointsRoot, metadata)
    const validation = await validateCheckpointRestoreContext({
      manifest,
      expected: {
        ...(expectedThreadId ? { expectedThreadId } : {}),
        ...(hasWorkspaceIdentity && expectedWorkspaceRoot ? { expectedWorkspaceRoot } : {})
      }
    }).catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
    if (!validation.ok) return { ok: false, reason: 'error', message: validation.message }
  }

  const repositoryReal = await realpath(metadata.repositoryRoot).catch(() => null)
  if (!repositoryReal) {
    return { ok: false, reason: 'no_workspace', message: `The checkpoint's repository no longer exists: ${metadata.repositoryRoot}` }
  }

  const preflight = emptyPreflight(checkpointId, repositoryReal)
  const entries: TurnUndoPlanEntry[] = []
  const resolved: Array<{ input: GitTurnUndoFileInput; path: string }> = []
  for (const input of inputs) {
    const path = await toRepositoryRelativePath(repositoryReal, input.path)
    if (!SHA256_PATTERN.test(input.afterSha256?.trim().toLowerCase() ?? '')) {
      // Without an end state the file cannot be verified, so it is never written.
      preflight.ignored.push({ path: path ?? input.path, reason: 'end_state_unknown' })
      continue
    }
    if (!path) {
      preflight.unsafe.push({ path: input.path, reason: 'outside_workspace' })
      continue
    }
    if (!resolved.some((entry) => entry.path === path)) resolved.push({ input, path })
  }

  const reader = await openCheckpointFileReader({ checkpointsRoot, metadata })
  let endReader: CheckpointFileReader | null = null
  try {
    const beforeByPath = await reader.readMany(resolved.map((entry) => entry.path))
    for (const { input, path } of resolved) {
      const unsafe = (reason: GitTurnUndoUnsafeFile['reason'], detail?: string): void => {
        preflight.unsafe.push({ path, reason, ...(detail ? { detail } : {}) })
      }
      let absolutePath: string
      try {
        absolutePath = await resolvePathWithinRepository(metadata.repositoryRoot, path)
      } catch {
        unsafe('outside_workspace')
        continue
      }
      let current: Awaited<ReturnType<typeof readCurrentFile>>
      try {
        current = await readCurrentFile(absolutePath)
      } catch (error) {
        unsafe('unreadable', error instanceof Error ? error.message : String(error))
        continue
      }
      const before = beforeByPath.get(path) ?? { kind: 'unavailable' as const, reason: 'unreadable' as const }
      if (before.kind === 'unavailable') {
        unsafe(before.reason, before.detail)
        continue
      }
      const beforeSha = before.kind === 'content' ? sha256Hex(before.bytes) : null
      const currentSha = current?.sha256 ?? null
      const afterSha = input.afterSha256?.trim().toLowerCase() ?? ''
      if (currentSha === beforeSha) {
        preflight.ignored.push({ path, reason: 'no_net_change' })
      } else if (!current || currentSha !== afterSha) {
        unsafe('modified_after_turn')
      } else {
        const action: GitTurnUndoSafeFile['action'] = before.kind === 'absent' ? 'delete' : 'restore'
        preflight.safe.push({ path, action })
        entries.push({
          path,
          absolutePath,
          action,
          before: before.kind === 'content' ? { bytes: before.bytes, executable: before.executable } : null,
          currentSha256: current.sha256
        })
      }
    }

    if (request.shellCommandsRan) {
      try {
        endReader = await openWindowEndReader(checkpointsRoot, repositoryReal, request.windowEndCheckpointId)
        const toolPaths = new Set([
          ...resolved.map((entry) => entry.path),
          ...preflight.unsafe.map((entry) => entry.path),
          ...preflight.ignored.map((entry) => entry.path)
        ])
        const shellChanged = (await listWindowChangedPaths({ start: reader, end: endReader }))
          .filter((path) => !toolPaths.has(path))
        const listed: GitTurnUndoIgnoredFile[] = shellChanged
          .slice(0, SHELL_CHANGED_LIST_LIMIT)
          .map((path) => ({ path, reason: 'shell_changed' }))
        preflight.ignored.push(...listed)
        preflight.ignoredOverflow = Math.max(0, shellChanged.length - listed.length)
      } catch {
        // Attribution is informational only; a failed scan must not block undo.
      }
    }
  } finally {
    await reader.dispose()
    await endReader?.dispose()
  }

  return { ok: true, plan: { preflight: finalizePreflight(preflight), entries, metadata, checkpointsRoot } }
}
