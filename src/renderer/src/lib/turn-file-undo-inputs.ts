import type { ChatBlock, ToolBlock } from '../agent/types'
import type { GitTurnUndoFileInput } from '@shared/git-turn-undo'

export type TurnFileState = { path: string; afterSha256: string }

const SHA256_PATTERN = /^[a-f0-9]{64}$/i

/** Reads the client-only `fileState` sideband Kun's write/edit tools attach. */
export function readToolFileState(meta: Record<string, unknown> | undefined): TurnFileState | null {
  const value = meta?.fileState
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { path, afterSha256 } = value as { path?: unknown; afterSha256?: unknown }
  if (typeof path !== 'string' || !path.trim()) return null
  if (typeof afterSha256 !== 'string' || !SHA256_PATTERN.test(afterSha256)) return null
  return { path: path.trim(), afterSha256: afterSha256.toLowerCase() }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path)
}

function joinWorkspacePath(workspaceRoot: string, path: string): string {
  if (!workspaceRoot || isAbsolutePath(path)) return path
  const separator = workspaceRoot.includes('\\') && !workspaceRoot.includes('/') ? '\\' : '/'
  return `${workspaceRoot.replace(/[\\/]+$/, '')}${separator}${path.replace(/^\.[\\/]/, '')}`
}

function pathKey(path: string): string {
  return path.replace(/\\/g, '/')
}

export type TurnUndoInputs = {
  files: GitTurnUndoFileInput[]
  shellCommandsRan: boolean
}

/**
 * Files a turn range changed through file tools, in order, with the last end
 * state per path. A file_change without the sideband (older turns, external
 * agents) is still listed with an unknown end state so preflight can explain
 * why it cannot be restored.
 */
export function collectTurnUndoInputs(blocks: readonly ChatBlock[], workspaceRoot: string): TurnUndoInputs {
  const byPath = new Map<string, GitTurnUndoFileInput>()
  let shellCommandsRan = false
  for (const block of blocks) {
    if (block.kind !== 'tool') continue
    if (block.toolKind === 'command_execution' && block.status !== 'running') shellCommandsRan = true
    if (block.toolKind !== 'file_change' || block.status !== 'success') continue
    const state = readToolFileState(block.meta)
    const rawPath = state?.path ?? (block as ToolBlock).filePath?.trim() ?? ''
    if (!rawPath) continue
    const path = joinWorkspacePath(workspaceRoot, rawPath)
    const key = pathKey(path)
    byPath.delete(key)
    byPath.set(key, { path, afterSha256: state?.afterSha256 ?? null })
  }
  return { files: [...byPath.values()], shellCommandsRan }
}

function blockTurnId(block: ChatBlock): string {
  if (block.kind !== 'user') return block.turnId?.trim() ?? ''
  return (block.turnId ?? block.meta?.turnId ?? '').trim()
}

export type TurnUndoRange = {
  checkpointId: string
  blocks: ChatBlock[]
  /** Checkpoint of the next turn when the range is not the last one. */
  windowEndCheckpointId?: string
}

/**
 * Slice a thread's flat block list into the range an undo covers: one turn
 * (`untilEnd: false`) or this turn and every later one (`untilEnd: true`,
 * used when an earlier message is edited and resent).
 */
export function resolveTurnUndoRange(
  blocks: readonly ChatBlock[],
  userBlockId: string,
  options: { untilEnd: boolean }
): TurnUndoRange | null {
  const start = blocks.findIndex((block) => block.id === userBlockId && block.kind === 'user')
  if (start < 0) return null
  const user = blocks[start]
  if (user.kind !== 'user') return null
  const checkpointId = user.meta?.workspaceCheckpointId?.trim()
  if (!checkpointId) return null
  if (options.untilEnd) return { checkpointId, blocks: blocks.slice(start + 1) }
  const turnId = blockTurnId(user)
  let end = blocks.length
  for (let index = start + 1; index < blocks.length; index += 1) {
    const candidate = blocks[index]
    if (candidate.kind !== 'user') continue
    const candidateTurnId = blockTurnId(candidate)
    if (!turnId || !candidateTurnId || candidateTurnId !== turnId) {
      end = index
      break
    }
  }
  const next = blocks[end]
  const windowEndCheckpointId = next?.kind === 'user' ? next.meta?.workspaceCheckpointId?.trim() : undefined
  return {
    checkpointId,
    blocks: blocks.slice(start + 1, end),
    ...(windowEndCheckpointId && windowEndCheckpointId !== checkpointId ? { windowEndCheckpointId } : {})
  }
}
