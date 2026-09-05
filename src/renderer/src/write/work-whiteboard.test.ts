import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileReadResult } from '@shared/workspace-file'
import { clearDesignPersistenceCoordinatorForTests } from '../design/design-persistence-coordinator'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { initialState } from './write-workspace-store-helpers'
import {
  WORK_WHITEBOARD_DIR,
  WORK_WHITEBOARD_INDEX,
  parseWorkWhiteboardRegistry,
  parseWorkWhiteboardRegistryResult,
  serializeWorkWhiteboardRegistry
} from './work-whiteboard'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const files = new Map<string, string>()
const directories = new Set<string>()
const savedAt = '2026-08-13T00:00:00.000Z'

const writeWorkspaceFile = vi.fn(async ({ path, content }: { path: string; content: string }) => {
  files.set(path, content)
  return { ok: true as const, path, savedAt }
})
const createWorkspaceDirectory = vi.fn(async ({ path }: { path: string }) => {
  if (directories.has(path)) return { ok: false as const, message: 'Directory already exists.' }
  directories.add(path)
  return { ok: true as const, path, createdAt: savedAt }
})
const createWorkspaceFile = vi.fn(async ({ path, content }: { path: string; content?: string }) => {
  if (!directories.has(WORK_WHITEBOARD_DIR) || files.has(path)) {
    return { ok: false as const, message: 'File already exists.' }
  }
  files.set(path, content ?? '')
  return { ok: true as const, path, createdAt: savedAt }
})
const deleteWorkspaceEntry = vi.fn(async ({ path }: { path: string }) => {
  for (const filePath of files.keys()) {
    if (filePath === path || filePath.startsWith(`${path}/`)) files.delete(filePath)
  }
  return { ok: true as const, path, deletedAt: savedAt }
})
const readWorkspaceFile = vi.fn(async ({ path }: { path: string }): Promise<WorkspaceFileReadResult> => {
  const content = files.get(path)
  if (content === undefined) return { ok: false, message: 'missing' }
  return { ok: true, path: `/work/${path}`, content, size: content.length, mtimeMs: 1, truncated: false }
})
const listWorkspaceDirectory = vi.fn(async () => ({
  ok: true as const,
  root: '/work',
  entries: directories.has(WORK_WHITEBOARD_DIR)
    ? [{ name: WORK_WHITEBOARD_DIR, path: `/work/${WORK_WHITEBOARD_DIR}`, type: 'directory' as const, ext: '' }]
    : []
}))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function seedRegistry(boards: Record<string, Parameters<typeof serializeWorkWhiteboardRegistry>[0][string]>): void {
  directories.add(WORK_WHITEBOARD_DIR)
  files.set(WORK_WHITEBOARD_INDEX, serializeWorkWhiteboardRegistry(boards))
}

beforeEach(() => {
  files.clear()
  directories.clear()
  writeWorkspaceFile.mockClear()
  createWorkspaceDirectory.mockClear()
  createWorkspaceFile.mockClear()
  deleteWorkspaceEntry.mockClear()
  readWorkspaceFile.mockClear()
  listWorkspaceDirectory.mockClear()
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    kunGui: {
      readWorkspaceFile,
      listWorkspaceDirectory,
      writeWorkspaceFile,
      createWorkspaceDirectory,
      createWorkspaceFile,
      deleteWorkspaceEntry
    }
  })
  useWriteWorkspaceStore.setState({
    ...initialState(),
    workspaceRoot: '/work',
    rootDirectory: '/work'
  })
})

afterEach(() => {
  clearDesignPersistenceCoordinatorForTests()
  vi.unstubAllGlobals()
})

describe('Work whiteboard registry', () => {
  it('parses versioned metadata and rejects unsafe board identities', () => {
    const content = JSON.stringify({
      version: 1,
      whiteboards: [
        {
          id: 'board-safe',
          title: 'Review',
          workspaceRoot: '/other',
          threadId: 'thread-1',
          sourcePath: '/work/source.md',
          phase: 'review',
          revision: 2,
          createdAt: '2026-08-13T00:00:00.000Z',
          updatedAt: '2026-08-13T00:00:01.000Z'
        },
        { id: '../escape', title: 'Unsafe' }
      ]
    })

    expect(parseWorkWhiteboardRegistry(content, '/work')).toEqual({})
    expect(parseWorkWhiteboardRegistryResult(content, '/work').valid).toBe(false)
  })

  it('loads a valid workspace registry from .kun-whiteboards and preserves stable serialization order', async () => {
    const later = {
      id: 'board-later', title: 'Later', workspaceRoot: '/work', threadId: null,
      phase: 'blank' as const, revision: 0,
      createdAt: '2026-08-13T00:00:01.000Z', updatedAt: '2026-08-13T00:00:01.000Z'
    }
    const earlier = {
      ...later,
      id: 'board-earlier',
      title: 'Earlier',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z'
    }
    const content = serializeWorkWhiteboardRegistry({ [later.id]: later, [earlier.id]: earlier })
    directories.add(WORK_WHITEBOARD_DIR)
    files.set(WORK_WHITEBOARD_INDEX, content)

    await useWriteWorkspaceStore.getState().loadWhiteboards('/work')

    expect(readWorkspaceFile).toHaveBeenCalledWith({ workspaceRoot: '/work', path: WORK_WHITEBOARD_INDEX })
    expect(Object.keys(useWriteWorkspaceStore.getState().whiteboards)).toEqual(['board-earlier', 'board-later'])
    expect(content.indexOf('board-earlier')).toBeLessThan(content.indexOf('board-later'))
  })

  it('does not read legacy .kun-write whiteboards when the new store is absent', async () => {
    files.set('.kun-write/whiteboards/index.json', serializeWorkWhiteboardRegistry({
      legacy: {
        id: 'legacy', title: 'Old board', workspaceRoot: '/work', threadId: null,
        phase: 'blank', revision: 0, createdAt: savedAt, updatedAt: savedAt
      }
    }))

    await useWriteWorkspaceStore.getState().loadWhiteboards('/work')

    expect(useWriteWorkspaceStore.getState().whiteboards).toEqual({})
    expect(readWorkspaceFile.mock.calls.map(([payload]) => payload.path)).toEqual([WORK_WHITEBOARD_INDEX])
  })

  it('creates the new store exclusively before writing its first registry', async () => {
    const board = await useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: 'First board' })

    expect(board).not.toBeNull()
    expect(createWorkspaceDirectory).toHaveBeenCalledWith({ workspaceRoot: '/work', path: WORK_WHITEBOARD_DIR })
    expect(createWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/work', path: WORK_WHITEBOARD_INDEX
    }))
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(parseWorkWhiteboardRegistry(files.get(WORK_WHITEBOARD_INDEX)!, '/work')[board!.id]).toMatchObject({
      title: 'First board'
    })
  })

  it('updates an existing valid registry without trying to claim its directory again', async () => {
    seedRegistry({})

    const board = await useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: 'Second board' })

    expect(board).not.toBeNull()
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      workspaceRoot: '/work', path: WORK_WHITEBOARD_INDEX
    }))
    expect(createWorkspaceDirectory).not.toHaveBeenCalled()
    expect(createWorkspaceFile).not.toHaveBeenCalled()
  })

  it('refuses an existing directory without a valid registry without writing into it', async () => {
    directories.add(WORK_WHITEBOARD_DIR)

    await expect(useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: 'Blocked' })).resolves.toBeNull()

    expect(createWorkspaceDirectory).not.toHaveBeenCalled()
    expect(createWorkspaceFile).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().fileError).toContain('.kun-whiteboards')
  })

  it('refuses a malformed existing registry without overwriting it', async () => {
    directories.add(WORK_WHITEBOARD_DIR)
    files.set(WORK_WHITEBOARD_INDEX, '{not json')

    await expect(useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: 'Blocked' })).resolves.toBeNull()

    expect(files.get(WORK_WHITEBOARD_INDEX)).toBe('{not json')
    expect(createWorkspaceDirectory).not.toHaveBeenCalled()
    expect(createWorkspaceFile).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
  })

  it('does not apply a whiteboard create after the active workspace changes', async () => {
    seedRegistry({})
    const pendingWrite = deferred<{ ok: true; path: string; savedAt: string }>()
    writeWorkspaceFile.mockImplementationOnce(() => pendingWrite.promise)

    const creating = useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: 'Stale board' })
    await vi.waitFor(() => expect(writeWorkspaceFile).toHaveBeenCalledTimes(1))

    useWriteWorkspaceStore.setState({
      ...initialState(),
      workspaceRoot: '/other-workspace',
      rootDirectory: '/other-workspace'
    })
    pendingWrite.resolve({ ok: true, path: WORK_WHITEBOARD_INDEX, savedAt })

    await expect(creating).resolves.toBeNull()
    const state = useWriteWorkspaceStore.getState()
    expect(state.workspaceRoot).toBe('/other-workspace')
    expect(state.whiteboards).toEqual({})
    expect(state.activeWhiteboardId).toBeNull()
  })

  it('creates, updates, binds, and deletes a board without a pseudo file session', async () => {
    const board = await useWriteWorkspaceStore.getState().createWhiteboard('/work', {
      title: 'Presentation review', sourcePath: '/work/source.md'
    })
    expect(board).not.toBeNull()
    if (!board) return

    let state = useWriteWorkspaceStore.getState()
    expect(state.editorLayout.groups[0]).toMatchObject({
      activePath: `whiteboard:${board.id}`,
      tabs: [{ kind: 'whiteboard', boardId: board.id }]
    })
    expect(state.activeWhiteboardId).toBe(board.id)
    expect(state.activeFilePath).toBeNull()
    expect(state.documentsByPath[`whiteboard:${board.id}`]).toBeUndefined()

    await expect(state.renameWhiteboard(board.id, 'Q3 review')).resolves.toBe(true)
    await expect(state.bindWhiteboardThread(board.id, 'thread-1')).resolves.toBe(true)
    await expect(state.bindWhiteboardThread(board.id, 'thread-2')).resolves.toBe(true)
    await expect(state.updateWhiteboardPptState(board.id, {
      phase: 'complete', outputPath: '/work/q3.pptx', childId: 'child-1', revision: 4
    })).resolves.toBe(true)
    await expect(state.updateWhiteboardPptState(board.id, { revision: 2 })).resolves.toBe(true)

    state = useWriteWorkspaceStore.getState()
    expect(state.whiteboards[board.id]).toMatchObject({
      title: 'Q3 review', threadId: 'thread-2', threadIds: ['thread-2', 'thread-1'], phase: 'complete',
      outputPath: '/work/q3.pptx', childId: 'child-1', revision: 4
    })

    await expect(state.forgetWhiteboardThread('thread-2')).resolves.toBe(true)
    state = useWriteWorkspaceStore.getState()
    expect(state.whiteboards[board.id]).toMatchObject({
      threadId: 'thread-1', threadIds: ['thread-1']
    })

    await expect(state.deleteWhiteboard(board.id)).resolves.toBe(true)
    state = useWriteWorkspaceStore.getState()
    expect(state.whiteboards[board.id]).toBeUndefined()
    expect(state.editorLayout.groups[0].tabs).toEqual([])
    expect(state.activeWhiteboardId).toBeNull()
    expect(deleteWorkspaceEntry).toHaveBeenCalledWith({
      workspaceRoot: '/work', path: `${WORK_WHITEBOARD_DIR}/${board.id}`
    })
  })

  it('keeps a canonical PPT board bound to its original child and parent thread', async () => {
    const board = await useWriteWorkspaceStore.getState().createWhiteboard('/work', {
      title: 'PPT review', threadId: 'thread-original', workflowId: 'workflow-a', childId: 'child-a'
    })
    expect(board).not.toBeNull()
    if (!board) return

    const state = useWriteWorkspaceStore.getState()
    await expect(state.updateWhiteboardPptState(board.id, {
      phase: 'review', childId: 'child-a', revision: 4
    })).resolves.toBe(true)
    await expect(state.updateWhiteboardPptState(board.id, {
      phase: 'directions', childId: 'child-a', revision: 5
    })).resolves.toBe(true)
    await expect(state.updateWhiteboardPptState(board.id, {
      phase: 'directions', childId: 'late-child', revision: 6
    })).resolves.toBe(true)
    await expect(state.bindWhiteboardThread(board.id, 'late-thread')).resolves.toBe(true)
    await expect(state.findOrCreatePptWhiteboard({
      workspaceRoot: '/work', threadId: 'thread-original', workflowId: 'workflow-a',
      title: 'PPT review', childId: 'late-child'
    })).resolves.toBeNull()

    expect(useWriteWorkspaceStore.getState().whiteboards[board.id]).toMatchObject({
      threadId: 'thread-original', threadIds: ['thread-original'],
      phase: 'review', childId: 'child-a', revision: 4
    })
  })

  it('rejects a blank title without touching storage', async () => {
    seedRegistry({})

    await expect(useWriteWorkspaceStore.getState().createWhiteboard('/work', { title: '   ' }))
      .resolves.toBeNull()

    expect(createWorkspaceDirectory).not.toHaveBeenCalled()
    expect(createWorkspaceFile).not.toHaveBeenCalled()
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    expect(useWriteWorkspaceStore.getState().whiteboards).toEqual({})
    expect(useWriteWorkspaceStore.getState().activeWhiteboardId).toBeNull()
    expect(useWriteWorkspaceStore.getState().fileError).toBeTruthy()
  })

  it('truncates an over-long title to 160 characters', async () => {
    seedRegistry({})

    const board = await useWriteWorkspaceStore.getState().createWhiteboard('/work', {
      title: `  ${'x'.repeat(200)}  `
    })

    expect(board?.title).toBe('x'.repeat(160))
    expect(parseWorkWhiteboardRegistry(files.get(WORK_WHITEBOARD_INDEX)!, '/work')[board!.id])
      .toMatchObject({ title: 'x'.repeat(160) })
  })

  it('creates the canonical PPT board with the provided title', async () => {
    seedRegistry({})

    const board = await useWriteWorkspaceStore.getState().findOrCreatePptWhiteboard({
      workspaceRoot: '/work', threadId: 'thread-a', workflowId: 'workflow-a',
      title: '  Text completion landscape  ', childId: 'child-a'
    })

    expect(board).toMatchObject({ title: 'Text completion landscape', workflowId: 'workflow-a' })

    const reopened = await useWriteWorkspaceStore.getState().findOrCreatePptWhiteboard({
      workspaceRoot: '/work', threadId: 'thread-a', workflowId: 'workflow-a',
      title: 'A different later title', childId: 'child-a'
    })
    expect(reopened?.id).toBe(board!.id)
    expect(useWriteWorkspaceStore.getState().whiteboards[board!.id]?.title)
      .toBe('Text completion landscape')
  })

  it('falls back to the source-based presentation title for legacy results', async () => {
    seedRegistry({})

    const board = await useWriteWorkspaceStore.getState().findOrCreatePptWhiteboard({
      workspaceRoot: '/work', threadId: 'thread-a', workflowId: 'workflow-a',
      title: '', sourcePath: '/work/brief.md'
    })

    expect(board?.title).toBe('brief · Presentation review')
  })
})
