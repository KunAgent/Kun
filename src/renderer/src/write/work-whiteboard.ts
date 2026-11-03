import type {
  WorkWhiteboard,
  WorkWhiteboardPhase,
  WriteEditorGroupId,
  WriteWorkspaceGet,
  WriteWorkspaceSet,
  WriteWorkspaceState
} from './write-workspace-store-types'
import { deleteDesignWorkspaceEntry } from '../design/design-persistence-coordinator'
import { normalizePath } from './write-workspace-store-helpers'
import { canvasEnginePersistField } from '../whiteboard/canvas-engine'
import i18n from '../i18n'
import {
  addEditorItemToGroup,
  captureFocusedDocument,
  clearWriteOfficeSelections,
  persistWriteEditorLayout,
  projectFocusedDocument,
  writeEditorItemKey
} from './write-editor-layout'
import { cancelPendingCanvasDocument } from '../design/canvas/canvas-persistence'
import { normalizeCanvasEngine, type CanvasEngine } from '../whiteboard/canvas-engine'
import {
  MAX_WORK_WHITEBOARD_THREAD_IDS,
  WORK_WHITEBOARD_DIR,
  loadWorkWhiteboardRegistry,
  persistWorkWhiteboardRegistry,
  whiteboardStorageMessage
} from './work-whiteboard-registry'

export {
  MAX_WORK_WHITEBOARD_THREAD_IDS,
  WORK_WHITEBOARD_DIR,
  WORK_WHITEBOARD_INDEX,
  parseWorkWhiteboardRegistry,
  parseWorkWhiteboardRegistryResult,
  serializeWorkWhiteboardRegistry
} from './work-whiteboard-registry'

export function workWhiteboardArtifactId(boardId: string): string {
  return boardId.trim()
}

export function workWhiteboardThreadIds(board: Pick<WorkWhiteboard, 'threadId' | 'threadIds'>): string[] {
  return [
    ...(board.threadId?.trim() ? [board.threadId.trim()] : []),
    ...(board.threadIds ?? []).flatMap((candidate) => {
      const id = candidate.trim()
      return id && id !== board.threadId?.trim() ? [id] : []
    })
  ].filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, MAX_WORK_WHITEBOARD_THREAD_IDS)
}

/** Unified whiteboard title rule: trimmed, non-empty, at most 160 chars. */
export function normalizeWorkWhiteboardTitle(raw: string | undefined | null): string {
  return raw?.trim().slice(0, 160) ?? ''
}

export function workWhiteboardResolvedEngine(
  board: Pick<WorkWhiteboard, 'engine' | 'workflowId'>
): CanvasEngine {
  if (board.workflowId?.trim()) return 'kun'
  return normalizeCanvasEngine(board.engine)
}

export function workWhiteboardEngineLocked(
  board: Pick<WorkWhiteboard, 'workflowId' | 'phase'>
): boolean {
  return Boolean(board.workflowId?.trim()) || board.phase !== 'blank'
}

export function workWhiteboardBaseDir(): string {
  return WORK_WHITEBOARD_DIR
}

export function workWhiteboardTabKey(boardId: string): string {
  return `whiteboard:${boardId.trim()}`
}

export function boardIdFromWriteTabKey(key: string | null | undefined): string | null {
  return key?.startsWith('whiteboard:') ? key.slice('whiteboard:'.length).trim() || null : null
}

const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Registry writes are read-modify-write over one index file, so they are
 * serialized per workspace. Without this, two boards created at the same time
 * can each persist a snapshot that is missing the other.
 */
const registryQueues = new Map<string, Promise<unknown>>()

function enqueueRegistryOperation<T>(workspaceRoot: string, task: () => Promise<T>): Promise<T> {
  const key = normalizePath(workspaceRoot)
  const previous = registryQueues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  registryQueues.set(key, next.then(() => undefined, () => undefined))
  return next
}

function workspaceIsCurrent(get: WriteWorkspaceGet, workspaceRoot: string): boolean {
  return normalizePath(get().workspaceRoot) === normalizePath(workspaceRoot)
}

function boardBelongsToWorkspace(board: WorkWhiteboard, workspaceRoot: string): boolean {
  return normalizePath(board.workspaceRoot) === normalizePath(workspaceRoot)
}

const whiteboardPhaseRank: Record<WorkWhiteboardPhase, number> = {
  blank: 0,
  directions: 1,
  review: 2,
  complete: 3
}

function nextWhiteboardPptPhase(
  current: WorkWhiteboardPhase,
  incoming: WorkWhiteboardPhase | undefined
): WorkWhiteboardPhase {
  return incoming && whiteboardPhaseRank[incoming] > whiteboardPhaseRank[current]
    ? incoming
    : current
}

function uniqueBoardId(): string {
  return `board-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function boundExcalidrawBoardForThread(
  whiteboards: Record<string, WorkWhiteboard>,
  threadId: string
): WorkWhiteboard | null {
  let best: WorkWhiteboard | null = null
  for (const board of Object.values(whiteboards)) {
    if (workWhiteboardResolvedEngine(board) !== 'excalidraw') continue
    if (!workWhiteboardThreadIds(board).includes(threadId)) continue
    if (!best || board.updatedAt > best.updatedAt) best = board
  }
  return best
}

type WhiteboardActions = Pick<WriteWorkspaceState,
  | 'ensureWhiteboards'
  | 'loadWhiteboards'
  | 'createWhiteboard'
  | 'openWhiteboard'
  | 'findOrCreatePptWhiteboard'
  | 'findOrCreateExcalidrawWhiteboard'
  | 'renameWhiteboard'
  | 'setWhiteboardEngine'
  | 'deleteWhiteboard'
  | 'bindWhiteboardThread'
  | 'forgetWhiteboardThread'
  | 'updateWhiteboardPptState'
>

export function createWorkWhiteboardActions(set: WriteWorkspaceSet, get: WriteWorkspaceGet): WhiteboardActions {
  let pendingLoad: { root: string; promise: Promise<boolean> } | null = null

  const readRegistry = async (workspaceRoot: string): Promise<boolean> => {
    const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
    if (!normalizedWorkspaceRoot || !workspaceIsCurrent(get, normalizedWorkspaceRoot)) return false
    set({ whiteboardsLoading: true })
    const registry = await loadWorkWhiteboardRegistry(normalizedWorkspaceRoot)
    if (!workspaceIsCurrent(get, normalizedWorkspaceRoot)) return false
    if (registry.kind === 'valid') {
      set({
        whiteboards: registry.whiteboards,
        whiteboardsLoading: false,
        whiteboardsLoadedRoot: normalizedWorkspaceRoot,
        whiteboardsLoadError: null
      })
      return true
    }
    if (registry.kind === 'missing') {
      // No whiteboard directory yet: a real empty space, not a read failure.
      set({
        whiteboards: {},
        whiteboardsLoading: false,
        whiteboardsLoadedRoot: normalizedWorkspaceRoot,
        whiteboardsLoadError: null
      })
      return true
    }
    const message = whiteboardStorageMessage(registry.kind)
    // Keep the loaded root unset: callers must retry instead of treating a
    // corrupt or unreadable registry as an empty one and overwriting it.
    set({ whiteboardsLoading: false, whiteboardsLoadedRoot: null, whiteboardsLoadError: message, fileError: message })
    return false
  }

  /**
   * Loads the whiteboard index at most once per workspace. Entering Work or
   * browsing artifacts must not read scenes, and every registry consumer must
   * await this before writing so an unloaded index is never persisted as empty.
   */
  const ensureWhiteboards = async (workspaceRoot: string): Promise<boolean> => {
    const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
    if (!normalizedWorkspaceRoot || !workspaceIsCurrent(get, normalizedWorkspaceRoot)) return false
    if (get().whiteboardsLoadedRoot === normalizedWorkspaceRoot) return true
    if (pendingLoad?.root === normalizedWorkspaceRoot) return pendingLoad.promise
    const promise: Promise<boolean> = readRegistry(normalizedWorkspaceRoot).finally(() => {
      if (pendingLoad?.promise === promise) pendingLoad = null
    })
    pendingLoad = { root: normalizedWorkspaceRoot, promise }
    return promise
  }

  const updateBoard = async (boardId: string, update: (board: WorkWhiteboard) => WorkWhiteboard): Promise<boolean> => {
    const workspaceRoot = normalizePath(get().workspaceRoot)
    if (!workspaceRoot) return false
    if (!(await ensureWhiteboards(workspaceRoot))) return false
    return enqueueRegistryOperation(workspaceRoot, async () => {
      const state = get()
      const board = state.whiteboards[boardId]
      if (!workspaceIsCurrent(get, workspaceRoot) || !board || !boardBelongsToWorkspace(board, workspaceRoot)) {
        return false
      }
      const whiteboards = { ...state.whiteboards, [boardId]: update(board) }
      const persisted = await persistWorkWhiteboardRegistry(workspaceRoot, whiteboards)
      if (!workspaceIsCurrent(get, workspaceRoot)) return false
      if (!persisted.ok) {
        set({ fileError: persisted.message })
        return false
      }
      set({ whiteboards })
      return true
    })
  }

  return {
    ensureWhiteboards,

    loadWhiteboards: async (workspaceRoot) => {
      const normalizedWorkspaceRoot = normalizePath(workspaceRoot)
      if (!normalizedWorkspaceRoot || !workspaceIsCurrent(get, normalizedWorkspaceRoot)) return
      if (pendingLoad?.root === normalizedWorkspaceRoot) {
        await pendingLoad.promise
        return
      }
      const promise: Promise<boolean> = readRegistry(normalizedWorkspaceRoot).finally(() => {
        if (pendingLoad?.promise === promise) pendingLoad = null
      })
      pendingLoad = { root: normalizedWorkspaceRoot, promise }
      await promise
    },

    createWhiteboard: async (workspaceRoot, options) => {
      const normalizedWorkspaceRoot = normalizePath(workspaceRoot.trim())
      const title = normalizeWorkWhiteboardTitle(options.title)
      if (!normalizedWorkspaceRoot || !workspaceIsCurrent(get, normalizedWorkspaceRoot)) return null
      if (!title) {
        set({ fileError: i18n.t('common:writeWhiteboardTitleRequired') })
        return null
      }
      // A registry that failed to load is unknown, not empty. Refuse the write
      // rather than persisting a snapshot that would drop existing boards.
      if (!(await ensureWhiteboards(normalizedWorkspaceRoot))) return null
      const requestedId = options.id?.trim()
      if (requestedId !== undefined && (!BOARD_ID_PATTERN.test(requestedId) || get().whiteboards[requestedId])) {
        return null
      }
      const board: WorkWhiteboard = {
        id: requestedId ?? uniqueBoardId(),
        title,
        workspaceRoot: normalizedWorkspaceRoot,
        threadId: options.threadId?.trim() || null,
        ...(options.threadId?.trim() ? { threadIds: [options.threadId.trim()] } : {}),
        ...(options.sourcePath?.trim() ? { sourcePath: normalizePath(options.sourcePath) } : {}),
        ...(options.workflowId?.trim() ? { workflowId: options.workflowId.trim() } : {}),
        ...(options.childId?.trim() ? { childId: options.childId.trim() } : {}),
        phase: options.workflowId ? 'directions' : 'blank',
        revision: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...canvasEnginePersistField(options.workflowId ? 'kun' : options.engine)
      }
      const created = await enqueueRegistryOperation(normalizedWorkspaceRoot, async () => {
        const current = get()
        if (!workspaceIsCurrent(get, normalizedWorkspaceRoot)) return false
        if (get().whiteboards[board.id]) return false
        const whiteboards = { ...current.whiteboards, [board.id]: board }
        const persisted = await persistWorkWhiteboardRegistry(normalizedWorkspaceRoot, whiteboards)
        if (!workspaceIsCurrent(get, normalizedWorkspaceRoot)) return false
        if (!persisted.ok) {
          set({ fileError: persisted.message })
          return false
        }
        set({ whiteboards })
        return true
      })
      if (!created) return null
      get().openWhiteboard(board.id, options.groupId)
      return board
    },

    openWhiteboard: (boardId, groupId) => {
      const rawState = get()
      const board = rawState.whiteboards[boardId]
      if (!board || !workspaceIsCurrent(get, rawState.workspaceRoot) || !boardBelongsToWorkspace(board, rawState.workspaceRoot)) {
        return
      }
      const documentsByPath = captureFocusedDocument(rawState)
      const targetGroup = groupId ?? rawState.editorLayout.focusedGroupId
      if (!rawState.editorLayout.groups.some((group) => group.id === targetGroup)) return
      const editorLayout = addEditorItemToGroup(rawState.editorLayout, targetGroup, {
        kind: 'whiteboard',
        boardId,
        viewMode: 'rich'
      })
      persistWriteEditorLayout(rawState.workspaceRoot, editorLayout)
      const clearedDocuments = clearWriteOfficeSelections(documentsByPath)
      set({
        documentsByPath: clearedDocuments,
        editorLayout,
        ...projectFocusedDocument(editorLayout, clearedDocuments)
      })
    },

    findOrCreatePptWhiteboard: async (input) => {
      const workspaceRoot = normalizePath(input.workspaceRoot)
      if (!workspaceRoot || !workspaceIsCurrent(get, workspaceRoot)) return null
      if (!(await ensureWhiteboards(workspaceRoot))) return null
      const canonicalBoards = Object.values(get().whiteboards).filter((board) =>
        boardBelongsToWorkspace(board, workspaceRoot) &&
        board.threadId === input.threadId && board.workflowId === input.workflowId
      )
      const incomingChildId = input.childId?.trim()
      const existing = canonicalBoards.find((board) =>
        !board.childId || !incomingChildId || board.childId === incomingChildId
      )
      if (existing) {
        get().openWhiteboard(existing.id)
        return existing
      }
      // A workflow's child identity is immutable. Refusing an unexpected
      // identity is safer than creating a second canonical board or retargeting
      // the board that contains the original workflow's selections.
      if (canonicalBoards.length > 0) return null
      const fallbackTitle = input.sourcePath
        ? `${input.sourcePath.split('/').pop()?.replace(/\.[^.]+$/, '')} · ${i18n.t('common:writePresentationReview')}`
        : i18n.t('common:writePresentationReview')
      return get().createWhiteboard(workspaceRoot, {
        title: normalizeWorkWhiteboardTitle(input.title) || fallbackTitle,
        sourcePath: input.sourcePath,
        threadId: input.threadId,
        workflowId: input.workflowId,
        childId: input.childId
      })
    },

    findOrCreateExcalidrawWhiteboard: async (input) => {
      const workspaceRoot = normalizePath(input.workspaceRoot)
      if (!workspaceRoot || !workspaceIsCurrent(get, workspaceRoot)) {
        return { ok: false as const, code: 'workspace_mismatch' as const }
      }
      if (!(await ensureWhiteboards(workspaceRoot))) {
        return { ok: false as const, code: 'create_failed' as const }
      }
      const requestedId = input.boardId?.trim()
      if (requestedId && !BOARD_ID_PATTERN.test(requestedId)) {
        return { ok: false as const, code: 'invalid_id' as const }
      }
      const threadId = input.threadId?.trim() || null
      const existing = requestedId
        ? get().whiteboards[requestedId] ?? null
        : threadId
          ? boundExcalidrawBoardForThread(get().whiteboards, threadId)
          : null
      if (existing) {
        let board = existing
        if (workWhiteboardResolvedEngine(board) !== 'excalidraw') {
          const switched = await get().setWhiteboardEngine(board.id, 'excalidraw')
          if (!switched) {
            return { ok: false as const, code: 'engine_locked' as const, board }
          }
          board = get().whiteboards[board.id] ?? board
        }
        if (threadId && !workWhiteboardThreadIds(board).includes(threadId)) {
          await get().bindWhiteboardThread(board.id, threadId)
          board = get().whiteboards[board.id] ?? board
        }
        get().openWhiteboard(board.id)
        return { ok: true as const, board, created: false }
      }
      const created = await get().createWhiteboard(workspaceRoot, {
        ...(requestedId ? { id: requestedId } : {}),
        title: normalizeWorkWhiteboardTitle(input.title) || requestedId || i18n.t('common:writeUntitledWhiteboard'),
        ...(threadId ? { threadId } : {}),
        engine: 'excalidraw'
      })
      if (!created) return { ok: false as const, code: 'create_failed' as const }
      return { ok: true as const, board: created, created: true }
    },

    renameWhiteboard: (boardId, title) => updateBoard(boardId, (board) => ({
      ...board,
      title: normalizeWorkWhiteboardTitle(title) || board.title,
      updatedAt: new Date().toISOString()
    })),

    setWhiteboardEngine: async (boardId, engine) => {
      const board = get().whiteboards[boardId]
      if (!board || workWhiteboardEngineLocked(board)) return false
      const nextEngine = normalizeCanvasEngine(engine)
      if (workWhiteboardResolvedEngine(board) === nextEngine) return true
      return updateBoard(boardId, (current) => {
        if (nextEngine === 'excalidraw') {
          return { ...current, engine: 'excalidraw', updatedAt: new Date().toISOString() }
        }
        const { engine: _removed, ...rest } = current
        return { ...rest, updatedAt: new Date().toISOString() }
      })
    },

    bindWhiteboardThread: (boardId, threadId) => updateBoard(boardId, (board) => {
      // PPT board refs are tied to their originating parent thread. Normal
      // boards may move to a new conversation; canonical workflow boards may
      // not be rebound after their identity has been established.
      const nextThreadId = board.workflowId && board.threadId
        ? board.threadId
        : threadId.trim() || board.threadId
      const threadIds = nextThreadId
        ? [
            nextThreadId,
            ...workWhiteboardThreadIds(board).filter((id) => id !== nextThreadId)
          ].slice(0, MAX_WORK_WHITEBOARD_THREAD_IDS)
        : workWhiteboardThreadIds(board)
      return {
        ...board,
        threadId: nextThreadId,
        ...(threadIds.length > 0 ? { threadIds } : {}),
        updatedAt: new Date().toISOString()
      }
    }),

    forgetWhiteboardThread: async (threadId) => {
      const targetId = threadId.trim()
      const workspaceRoot = normalizePath(get().workspaceRoot)
      if (!targetId || !workspaceRoot) return false
      if (!(await ensureWhiteboards(workspaceRoot))) return false
      return enqueueRegistryOperation(workspaceRoot, async () => {
        const state = get()
        let changed = false
        const whiteboards = Object.fromEntries(Object.entries(state.whiteboards).map(([boardId, board]) => {
          if (!boardBelongsToWorkspace(board, workspaceRoot)) return [boardId, board]
          const currentIds = workWhiteboardThreadIds(board)
          if (!currentIds.includes(targetId)) return [boardId, board]
          changed = true
          const threadIds = currentIds.filter((id) => id !== targetId)
          return [boardId, {
            ...board,
            threadId: board.threadId === targetId ? threadIds[0] ?? null : board.threadId,
            threadIds,
            updatedAt: new Date().toISOString()
          }]
        }))
        if (!changed) return true
        const persisted = await persistWorkWhiteboardRegistry(workspaceRoot, whiteboards)
        if (!workspaceIsCurrent(get, workspaceRoot)) return false
        if (!persisted.ok) {
          set({ fileError: persisted.message })
          return false
        }
        set({ whiteboards })
        return true
      })
    },

    updateWhiteboardPptState: (boardId, patch) => updateBoard(boardId, (board) => {
      const incomingChildId = patch.childId?.trim()
      const childMatches = !board.childId || !incomingChildId || board.childId === incomingChildId
      const phase = childMatches ? nextWhiteboardPptPhase(board.phase, patch.phase) : board.phase
      const acceptsPhasePayload = childMatches && (!patch.phase ||
        whiteboardPhaseRank[patch.phase] >= whiteboardPhaseRank[board.phase])
      const incomingRevision = Number.isInteger(patch.revision) && Number(patch.revision) >= 0
        ? Number(patch.revision)
        : null
      const advancesPhase = Boolean(patch.phase) &&
        whiteboardPhaseRank[patch.phase!] > whiteboardPhaseRank[board.phase]
      // Direction and review revisions are separate counters. A transition to
      // review adopts its own revision; a delayed direction result must not
      // inflate the review's high-water mark in registry metadata.
      const revision = !childMatches || incomingRevision === null || !acceptsPhasePayload
        ? board.revision
        : advancesPhase && patch.phase !== 'complete'
          ? incomingRevision
          : Math.max(board.revision, incomingRevision)
      return {
        ...board,
        phase,
        ...(acceptsPhasePayload && patch.phase === 'complete' && patch.outputPath?.trim()
          ? { outputPath: normalizePath(patch.outputPath) }
          : {}),
        ...(childMatches && !board.childId && incomingChildId ? { childId: incomingChildId } : {}),
        revision,
        updatedAt: new Date().toISOString()
      }
    }),

    deleteWhiteboard: async (boardId) => {
      const workspaceRoot = normalizePath(get().workspaceRoot)
      if (!workspaceRoot) return false
      if (!(await ensureWhiteboards(workspaceRoot))) return false
      return enqueueRegistryOperation(workspaceRoot, async () => {
        const state = get()
        const board = state.whiteboards[boardId]
        if (!workspaceIsCurrent(get, workspaceRoot) || !board || !boardBelongsToWorkspace(board, workspaceRoot)) {
          return false
        }
        const whiteboards = { ...state.whiteboards }
        delete whiteboards[boardId]
        const persisted = await persistWorkWhiteboardRegistry(workspaceRoot, whiteboards)
        if (!persisted.ok) {
          set({ fileError: persisted.message })
          return false
        }
        await cancelPendingCanvasDocument(workspaceRoot, boardId, WORK_WHITEBOARD_DIR)
        await deleteDesignWorkspaceEntry({
          workspaceRoot,
          path: `${WORK_WHITEBOARD_DIR}/${boardId}`
        })
        if (!workspaceIsCurrent(get, workspaceRoot)) return true
        const boardKey = workWhiteboardTabKey(boardId)
        const groups = state.editorLayout.groups.map((group) => {
          const tabs = group.tabs.filter((item) => writeEditorItemKey(item) !== boardKey)
          const activePath = group.activePath === boardKey
            ? tabs[0] ? writeEditorItemKey(tabs[0]) : null
            : group.activePath
          return { ...group, tabs, activePath }
        })
        const editorLayout = { ...state.editorLayout, groups }
        persistWriteEditorLayout(workspaceRoot, editorLayout)
        const documentsByPath = captureFocusedDocument(state)
        set({
          whiteboards,
          documentsByPath,
          editorLayout,
          ...projectFocusedDocument(editorLayout, documentsByPath)
        })
        return true
      })
    }
  }
}

export function whiteboardForFocusedGroup(state: Pick<WriteWorkspaceState, 'editorLayout' | 'whiteboards'>): WorkWhiteboard | null {
  const group = state.editorLayout.groups.find((candidate) => candidate.id === state.editorLayout.focusedGroupId)
  const boardId = boardIdFromWriteTabKey(group?.activePath)
  return boardId ? state.whiteboards[boardId] ?? null : null
}

export function workWhiteboardGroupId(state: Pick<WriteWorkspaceState, 'editorLayout'>, boardId: string): WriteEditorGroupId | null {
  const group = state.editorLayout.groups.find((candidate) => candidate.tabs.some(
    (tab) => tab.kind === 'whiteboard' && tab.boardId === boardId
  ))
  return group?.id ?? null
}
