import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomContentOpenTarget } from '@shared/rooms-api'
const mocks = vi.hoisted(() => ({ route: vi.fn(), preview: vi.fn() }))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ setRoute: mocks.route }) } }))
vi.mock('../../project-board/project-board-store', () => ({ useProjectBoardStore: { getState: () => ({ selectWorkspace: vi.fn() }) } }))
vi.mock('../../project-board/project-board-api', () => ({ projectBoardApi: { card: vi.fn() } }))
vi.mock('../../lib/workspace-file-preview', () => ({ previewWorkspaceFile: mocks.preview }))
vi.mock('./room-excalidraw-store', () => ({ useRoomExcalidrawStore: { getState: vi.fn() } }))
import { openRoomContentTarget } from './room-content-navigation'

describe('room file content navigation', () => {
  const resolve = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', { kunGui: { resolveWorkspaceFile: resolve } })
    resolve.mockResolvedValue({ ok: true, path: '/room/report.md' })
  })
  afterEach(() => vi.unstubAllGlobals())
  it.each(['code_file', 'work_file'] as const)('previews a %s without changing the active recipient or route', async (kind) => {
    const openThread = vi.fn()
    await openRoomContentTarget({ kind, workspaceRoot: '/room', relativePath: 'report.md' }, openThread, 'room')
    expect(mocks.preview).toHaveBeenCalledWith({ path: '/room/report.md', workspaceRoot: '/room' })
    expect(mocks.route).not.toHaveBeenCalled()
    expect(openThread).not.toHaveBeenCalled()
  })
  it('ignores a file resolution that finishes after the room selection changed', async () => {
    let finish: (result: { ok: boolean; path: string }) => void = () => undefined
    resolve.mockReturnValue(new Promise((accept) => { finish = accept }))
    let current = true
    const target: RoomContentOpenTarget = { kind: 'code_file', workspaceRoot: '/room', relativePath: 'report.md' }
    const pending = openRoomContentTarget(target, vi.fn(), 'room', () => current)
    current = false
    finish({ ok: true, path: '/room/report.md' })
    await pending
    expect(mocks.preview).not.toHaveBeenCalled()
  })
  it('retains explicit navigation to an associated Code task', async () => {
    const openThread = vi.fn()
    await openRoomContentTarget({ kind: 'thread', threadId: 'task', turnId: 'turn' }, openThread, 'room')
    expect(openThread).toHaveBeenCalledWith('task', 'turn')
    expect(mocks.preview).not.toHaveBeenCalled()
  })
})
