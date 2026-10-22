import type { WorkWhiteboard, WorkWhiteboardPhase } from './write-workspace-store-types'
import { canvasEnginePersistField, normalizeCanvasEngine } from '../whiteboard/canvas-engine'
import { writeDesignWorkspaceFile } from '../design/design-persistence-coordinator'
import { normalizePath } from './write-workspace-store-helpers'
import i18n from '../i18n'

export const WORK_WHITEBOARD_DIR = '.kun-whiteboards'
export const WORK_WHITEBOARD_INDEX = `${WORK_WHITEBOARD_DIR}/index.json`
export const MAX_WORK_WHITEBOARD_THREAD_IDS = 20

type WorkWhiteboardRegistryV1 = {
  version: 1
  whiteboards: WorkWhiteboard[]
}

export type WorkWhiteboardRegistryParseResult = {
  valid: boolean
  whiteboards: Record<string, WorkWhiteboard>
}

export type WorkWhiteboardRegistryLoadResult =
  | { kind: 'valid'; whiteboards: Record<string, WorkWhiteboard> }
  | { kind: 'missing' | 'invalid' | 'unavailable' }

export type WorkWhiteboardRegistryPersistResult =
  | { ok: true }
  | { ok: false; message: string }

function normalizeBoard(value: unknown, workspaceRoot: string): WorkWhiteboard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<WorkWhiteboard>
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id) || !title) return null
  const phase: WorkWhiteboardPhase = raw.phase === 'directions' || raw.phase === 'review' || raw.phase === 'complete'
    ? raw.phase
    : 'blank'
  const createdAt = typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date(0).toISOString()
  const updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : createdAt
  const threadId = typeof raw.threadId === 'string' && raw.threadId.trim() ? raw.threadId.trim() : null
  const threadIds = [
    ...(threadId ? [threadId] : []),
    ...(Array.isArray(raw.threadIds) ? raw.threadIds : []).flatMap((candidate) => {
      const id = typeof candidate === 'string' ? candidate.trim() : ''
      return id && id !== threadId ? [id] : []
    })
  ].filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, MAX_WORK_WHITEBOARD_THREAD_IDS)
  return {
    id,
    title,
    workspaceRoot: normalizePath(workspaceRoot),
    threadId,
    ...(threadIds.length > 0 ? { threadIds } : {}),
    ...(typeof raw.sourcePath === 'string' && raw.sourcePath.trim() ? { sourcePath: normalizePath(raw.sourcePath) } : {}),
    ...(typeof raw.workflowId === 'string' && raw.workflowId.trim() ? { workflowId: raw.workflowId.trim() } : {}),
    ...(typeof raw.childId === 'string' && raw.childId.trim() ? { childId: raw.childId.trim() } : {}),
    ...(typeof raw.outputPath === 'string' && raw.outputPath.trim() ? { outputPath: normalizePath(raw.outputPath) } : {}),
    phase,
    revision: Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
    createdAt,
    updatedAt,
    ...canvasEnginePersistField(normalizeCanvasEngine(raw.engine))
  }
}

export function parseWorkWhiteboardRegistryResult(
  content: string,
  workspaceRoot: string
): WorkWhiteboardRegistryParseResult {
  try {
    const parsed = JSON.parse(content) as Partial<WorkWhiteboardRegistryV1>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      parsed.version !== 1 || !Array.isArray(parsed.whiteboards)) {
      return { valid: false, whiteboards: {} }
    }
    const boards = parsed.whiteboards.map((board) => normalizeBoard(board, workspaceRoot))
    if (boards.some((board) => !board)) return { valid: false, whiteboards: {} }
    const normalizedBoards = boards as WorkWhiteboard[]
    const whiteboards = Object.fromEntries(normalizedBoards.map((board) => [board.id, board]))
    return {
      valid: Object.keys(whiteboards).length === normalizedBoards.length,
      whiteboards
    }
  } catch {
    return { valid: false, whiteboards: {} }
  }
}

export function parseWorkWhiteboardRegistry(content: string, workspaceRoot: string): Record<string, WorkWhiteboard> {
  return parseWorkWhiteboardRegistryResult(content, workspaceRoot).whiteboards
}

export function serializeWorkWhiteboardRegistry(boards: Record<string, WorkWhiteboard>): string {
  const registry: WorkWhiteboardRegistryV1 = {
    version: 1,
    whiteboards: Object.values(boards).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }
  return `${JSON.stringify(registry, null, 2)}\n`
}

export function whiteboardStorageMessage(kind: 'invalid' | 'unavailable'): string {
  return i18n.t(kind === 'invalid'
    ? 'common:writeWhiteboardStorageConflict'
    : 'common:writeWhiteboardStorageUnavailable')
}

async function whiteboardDirectoryStatus(
  workspaceRoot: string
): Promise<'missing' | 'present' | 'unavailable'> {
  try {
    const result = await window.kunGui.listWorkspaceDirectory({ workspaceRoot })
    if (!result.ok) return 'unavailable'
    return result.entries.some((entry) => entry.name === WORK_WHITEBOARD_DIR)
      ? 'present'
      : 'missing'
  } catch {
    return 'unavailable'
  }
}

/**
 * Reads only the small registry file. Board scenes stay on disk until a board
 * is actually opened, so entering Work never loads whiteboard content.
 */
export async function loadWorkWhiteboardRegistry(
  workspaceRoot: string
): Promise<WorkWhiteboardRegistryLoadResult> {
  try {
    const result = await window.kunGui.readWorkspaceFile({
      workspaceRoot,
      path: WORK_WHITEBOARD_INDEX
    })
    if (result.ok) {
      const parsed = parseWorkWhiteboardRegistryResult(result.content, workspaceRoot)
      return parsed.valid ? { kind: 'valid', whiteboards: parsed.whiteboards } : { kind: 'invalid' }
    }
  } catch {
    // The root listing below distinguishes an uninitialized directory from an
    // existing directory whose index cannot be read or parsed.
  }
  const directoryStatus = await whiteboardDirectoryStatus(workspaceRoot)
  if (directoryStatus === 'missing') return { kind: 'missing' }
  return { kind: directoryStatus === 'present' ? 'invalid' : 'unavailable' }
}

export async function persistWorkWhiteboardRegistry(
  workspaceRoot: string,
  boards: Record<string, WorkWhiteboard>
): Promise<WorkWhiteboardRegistryPersistResult> {
  const content = serializeWorkWhiteboardRegistry(boards)
  const current = await loadWorkWhiteboardRegistry(workspaceRoot)
  if (current.kind === 'valid') {
    const result = await writeDesignWorkspaceFile({ workspaceRoot, path: WORK_WHITEBOARD_INDEX, content })
    return result.ok ? { ok: true } : { ok: false, message: i18n.t('common:writeWhiteboardSaveFailed') }
  }
  if (current.kind !== 'missing') {
    return { ok: false, message: whiteboardStorageMessage(current.kind) }
  }

  try {
    const directory = await window.kunGui.createWorkspaceDirectory({
      workspaceRoot,
      path: WORK_WHITEBOARD_DIR
    })
    if (!directory.ok) return { ok: false, message: whiteboardStorageMessage('invalid') }
    const registry = await window.kunGui.createWorkspaceFile({
      workspaceRoot,
      path: WORK_WHITEBOARD_INDEX,
      content
    })
    return registry.ok
      ? { ok: true }
      : { ok: false, message: whiteboardStorageMessage('invalid') }
  } catch {
    return { ok: false, message: whiteboardStorageMessage('unavailable') }
  }
}
