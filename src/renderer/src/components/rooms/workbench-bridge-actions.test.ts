import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  list: vi.fn(),
  roomsRequest: vi.fn(),
  watch: vi.fn(),
  setRoute: vi.fn(),
  flash: vi.fn(),
  workRoots: ['/work/notes', '/work']
}))
vi.mock('../../lib/browser-storage', () => ({
  readBrowserStorageItem: (key: string) => mocks.storage.get(key) ?? null,
  writeBrowserStorageItem: (key: string, value: string) => { mocks.storage.set(key, value) }
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: { getState: () => ({ setRoute: mocks.setRoute, codeWorkspaceRoots: [] }), subscribe: () => () => undefined } }))
vi.mock('../../write/write-workspace-store', () => ({ useWriteWorkspaceStore: {
  getState: () => ({ workspaceRoots: mocks.workRoots, defaultWorkspaceRoot: '' }), subscribe: () => () => undefined } }))
vi.mock('./rooms-client', () => ({ roomsClient: { list: mocks.list }, roomsRequest: mocks.roomsRequest, roomRequestId: () => 'req-1' }))
vi.mock('./workbench-client', () => ({ workbenchClient: { watch: mocks.watch, setDirectory: vi.fn() } }))
vi.mock('./workbench-flash', () => ({ showWorkbenchFlash: mocks.flash }))

import { resolveBotRoomId, sendBoardCardToBot, sendThreadToBot, sendWorkDocumentToBot, sendWorkFileToBot, watchThreadWithBot, workRelativePath } from './workbench-bridge-actions'

const draft = (roomId: string) => JSON.parse(mocks.storage.get(`kun.rooms.draft.${roomId}`) ?? 'null')

describe('workbench bridge actions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    mocks.storage.clear()
    for (const mock of [mocks.list, mocks.roomsRequest, mocks.watch, mocks.setRoute, mocks.flash]) mock.mockReset()
    mocks.list.mockResolvedValue({ rooms: [{ id: 'room-recent' }, { id: 'room-old' }] })
  })

  it('picks the selected private chat, else the most recent, else the default entry', async () => {
    expect(await resolveBotRoomId()).toBe('room-recent')
    mocks.storage.set('kun.rooms.selected', 'room-old')
    expect(await resolveBotRoomId()).toBe('room-old')
    mocks.storage.set('kun.rooms.selected', 'a-group-room')
    expect(await resolveBotRoomId()).toBe('room-recent')
    mocks.list.mockResolvedValue({ rooms: [] })
    mocks.roomsRequest.mockResolvedValue({ roomId: 'room-default' })
    expect(await resolveBotRoomId()).toBe('room-default')
    expect(mocks.roomsRequest).toHaveBeenCalledWith('/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: 'req-1' })
  })

  it('puts a Code session in the bot draft without sending anything, then opens the chat', async () => {
    await sendThreadToBot({ id: 'thread-1', title: 'Fix SSE' })
    expect(draft('room-recent')).toMatchObject({ body: '', references: [{ kind: 'code_thread', threadId: 'thread-1', titleSnapshot: 'Fix SSE' }] })
    expect(mocks.storage.get('kun.agentChats.selected')).toBe('room-recent')
    expect(mocks.setRoute).toHaveBeenCalledWith('agent-chat')
    expect(mocks.roomsRequest).not.toHaveBeenCalled()
  })

  it('keeps what the user was already typing and never duplicates a reference', async () => {
    mocks.storage.set('kun.rooms.draft.room-recent', JSON.stringify({ body: 'please look at this', mentions: [], references: [{ kind: 'code_thread', threadId: 'thread-1' }] }))
    await sendThreadToBot({ id: 'thread-1', title: 'Fix SSE' })
    await sendThreadToBot({ id: 'thread-2', title: 'Other' })
    expect(draft('room-recent').body).toBe('please look at this')
    expect(draft('room-recent').references.map((reference: { threadId: string }) => reference.threadId)).toEqual(['thread-1', 'thread-2'])
  })

  it('locates a Work file in the longest matching workspace and cites it with a quoted excerpt', async () => {
    expect(workRelativePath('/work/notes/plan.md', ['/work', '/work/notes'])).toEqual({ root: '/work/notes', relativePath: 'plan.md' })
    expect(workRelativePath('C:\\docs\\a\\b.md', ['C:\\docs'])).toEqual({ root: 'C:\\docs', relativePath: 'a/b.md' })
    expect(workRelativePath('/elsewhere/x.md', ['/work'])).toBeNull()
    await sendWorkFileToBot('/work/notes/plan.md')
    expect(draft('room-recent').references).toEqual([{ kind: 'work_document', workspaceRoot: '/work/notes', relativePath: 'plan.md', titleSnapshot: 'plan.md' }])
    await sendWorkDocumentToBot({ workspaceRoot: '/work', relativePath: 'a.md', excerpt: 'line one\nline two' })
    expect(draft('room-recent').body).toBe('> line one\n> line two')
    mocks.flash.mockClear()
    await sendWorkFileToBot('/outside/file.md')
    expect(mocks.flash).toHaveBeenCalledWith(expect.stringContaining('Work workspace'), 'error')
  })

  it('hands a board card over as plain text', async () => {
    await sendBoardCardToBot({ title: 'Write docs', description: 'Explain the bridge', workspaceRoot: '/work/app', priority: 'P1' })
    expect(draft('room-recent').body).toBe('Board card: Write docs (P1)\nExplain the bridge\nProject: /work/app')
    expect(draft('room-recent').references).toEqual([])
  })

  it('asks the bot to watch a running session and reports the outcome', async () => {
    mocks.watch.mockResolvedValue({ id: 'link-1' })
    await watchThreadWithBot({ id: 'thread-1', title: 'Long job' })
    expect(mocks.watch).toHaveBeenCalledWith('room-recent', 'thread-1', 'Long job')
    expect(mocks.flash).toHaveBeenCalledWith('The Agent will let you know when this session finishes.')
    mocks.watch.mockRejectedValue(new Error('the session is not running'))
    await watchThreadWithBot({ id: 'thread-2', title: 'Idle' })
    expect(mocks.flash).toHaveBeenLastCalledWith('the session is not running', 'error')
  })

  it('explains when there is no bot to send to', async () => {
    mocks.list.mockResolvedValue({ rooms: [] })
    mocks.roomsRequest.mockResolvedValue({})
    await sendThreadToBot({ id: 'thread-1', title: 'x' })
    expect(mocks.flash).toHaveBeenCalledWith(expect.stringContaining('No Agent conversation'), 'error')
    expect(mocks.setRoute).not.toHaveBeenCalled()
  })
})
