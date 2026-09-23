import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWriteDocumentSession } from './write-editor-layout'
import { useWriteWorkspaceStore } from './write-workspace-store'
import { initialState } from './write-workspace-store-helpers'
import type { WorkWhiteboard } from './write-workspace-store-types'
import { MemoryStorage } from './write-workspace-file-actions-test-support'

const board: WorkWhiteboard = {
  id: 'board-1',
  title: 'Presentation review',
  workspaceRoot: '/work',
  threadId: 'thread-1',
  phase: 'review',
  revision: 2,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z'
}

beforeEach(() => {
  vi.stubGlobal('window', {
    localStorage: new MemoryStorage(),
    kunGui: {
      renameWorkspaceEntry: vi.fn(async () => ({
        ok: true as const,
        previousPath: '/work/file.md',
        path: '/work/renamed.md',
        renamedAt: '2026-08-13T00:00:01.000Z'
      })),
      deleteWorkspaceEntry: vi.fn(async () => ({
        ok: true as const,
        path: '/work/renamed.md',
        deletedAt: '2026-08-13T00:00:02.000Z'
      })),
      listWorkspaceDirectory: vi.fn(async () => ({
        ok: true as const,
        root: '/work',
        entries: []
      }))
    }
  })
  useWriteWorkspaceStore.setState({
    ...initialState(),
    workspaceRoot: '/work',
    rootDirectory: '/work',
    whiteboards: { [board.id]: board },
    documentsByPath: {
      '/work/file.md': createWriteDocumentSession({
        path: '/work/file.md',
        kind: 'text',
        fileContent: 'draft',
        persistedContent: 'draft'
      })
    },
    activeWhiteboardId: board.id,
    editorLayout: {
      version: 1,
      orientation: 'single',
      ratio: 0.5,
      focusedGroupId: 'primary',
      groups: [{
        id: 'primary',
        activePath: 'whiteboard:board-1',
        tabs: [
          { path: '/work/file.md', viewMode: 'rich' },
          { kind: 'whiteboard', boardId: board.id, viewMode: 'rich' }
        ]
      }]
    }
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Work whiteboard file-action isolation', () => {
  it('keeps board metadata and tabs intact while a regular file is renamed and deleted', async () => {
    const actions = useWriteWorkspaceStore.getState()

    await expect(actions.renameEntry('/work', '/work/file.md', 'renamed.md'))
      .resolves.toBe('/work/renamed.md')

    let state = useWriteWorkspaceStore.getState()
    expect(state.whiteboards[board.id]).toBe(board)
    expect(state.activeWhiteboardId).toBe(board.id)
    expect(state.editorLayout.groups[0]).toMatchObject({
      activePath: 'whiteboard:board-1',
      tabs: [
        { path: '/work/renamed.md' },
        { kind: 'whiteboard', boardId: board.id }
      ]
    })

    await expect(state.deleteEntry('/work', '/work/renamed.md')).resolves.toBe(true)

    state = useWriteWorkspaceStore.getState()
    expect(state.whiteboards[board.id]).toBe(board)
    expect(state.activeWhiteboardId).toBe(board.id)
    expect(state.editorLayout.groups[0]).toMatchObject({
      activePath: 'whiteboard:board-1',
      tabs: [{ kind: 'whiteboard', boardId: board.id }]
    })
    expect(state.documentsByPath).toEqual({})
  })
})
