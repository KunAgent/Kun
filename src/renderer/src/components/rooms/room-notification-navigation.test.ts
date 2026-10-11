import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room } from '@shared/rooms-api'
import { writeBrowserStorageItem } from '../../lib/browser-storage'
const mocks = vi.hoisted(() => ({
  state: { route: 'chat', activeThreadId: null as string | null, workspaceRoot: '/code' },
  listeners: new Set<(state: { route: string; activeThreadId: string | null; workspaceRoot: string }, previous: { route: string; activeThreadId: string | null; workspaceRoot: string }) => void>(),
  get: vi.fn(), open: vi.fn(), focus: vi.fn(() => true)
}))
vi.mock('../../store/chat-store', () => ({ useChatStore: {
  getState: () => ({ ...mocks.state, setRoute: (route: string) => changeState({ route }) }),
  subscribe: (listener: typeof mocks.listeners extends Set<infer T> ? T : never) => {
    mocks.listeners.add(listener); return () => { mocks.listeners.delete(listener) }
  }
} }))
vi.mock('./rooms-client', () => ({ roomsClient: { get: mocks.get } }))
vi.mock('./agent-chat-navigation', () => ({ openAgentConversationRoom: mocks.open }))
import { createRoomNotificationNavigator, isFocusedRoomConversation } from './room-notification-navigation'

function changeState(patch: Partial<typeof mocks.state>) {
  const previous = { ...mocks.state }
  Object.assign(mocks.state, patch)
  mocks.listeners.forEach((listener) => listener(mocks.state, previous))
}
const room = (id: string, conversationKind: 'group' | 'user_agent') => ({ id, conversationKind } as Room)

describe('native room notification navigation', () => {
  const storage = new Map<string, string>()
  let navigator: ReturnType<typeof createRoomNotificationNavigator>
  beforeEach(() => {
    storage.clear(); mocks.listeners.clear(); mocks.get.mockReset(); mocks.open.mockReset()
    Object.assign(mocks.state, { route: 'chat', activeThreadId: 'task', workspaceRoot: '/code' })
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) } })
    vi.stubGlobal('document', { hasFocus: mocks.focus })
    navigator = createRoomNotificationNavigator({ isStopped: () => false })
  })
  afterEach(() => { navigator.dispose(); vi.unstubAllGlobals() })
  it('routes a private Agent notification to its original conversation and optional target', async () => {
    mocks.get.mockResolvedValue({ room: room('private', 'user_agent') })
    await navigator.open({ roomId: 'private', runId: 'run', messageId: 'message' })
    expect(mocks.open).toHaveBeenCalledWith('private', { runId: 'run', messageId: 'message' })
    expect(storage.get('kun.rooms.selected')).toBeUndefined()
  })
  it('opens group notifications as Code conversations instead of a separate mode', async () => {
    mocks.get.mockResolvedValue({ room: room('group', 'group') })
    await navigator.open({ roomId: 'group' })
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith('group', undefined)
    expect(mocks.state.route).toBe('chat')
    expect(storage.get('kun.rooms.selected')).toBeUndefined()
  })
  it('cancels a pending notification after the user changes routes and returns', async () => {
    let finish: (value: { room: Room }) => void = () => undefined
    mocks.get.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const pending = navigator.open({ roomId: 'group' })
    changeState({ route: 'agent-chat' }); changeState({ route: 'chat' })
    finish({ room: room('group', 'group') })
    await pending
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('lets a newer notification click supersede a pending lookup', async () => {
    let finish: (value: { room: Room }) => void = () => undefined
    mocks.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const pending = navigator.open({ roomId: 'old' })
    mocks.get.mockResolvedValueOnce({ room: room('new', 'group') })
    await navigator.open({ roomId: 'new' })
    finish({ room: room('old', 'user_agent') })
    await pending
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith('new', undefined)
  })
  it.each(['route', 'agent', 'task'] as const)('does not steal navigation after a user leaves and returns through %s selection', async (kind) => {
    let finish: (value: { room: Room }) => void = () => undefined
    mocks.get.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    storage.set('kun.agentChats.selected', 'original')
    const pending = navigator.open({ roomId: 'private' })
    if (kind === 'route') { changeState({ route: 'agent-chat' }); changeState({ route: 'chat' }) }
    else if (kind === 'task') { changeState({ activeThreadId: 'next' }); changeState({ activeThreadId: 'task' }) }
    else {
      writeBrowserStorageItem('kun.agentChats.selected', 'next'); writeBrowserStorageItem('kun.agentChats.selected', 'original')
    }
    finish({ room: room('private', 'user_agent') })
    await pending
    expect(mocks.open).not.toHaveBeenCalled()
  })
  it('suppresses notifications only for the focused Code conversation', () => {
    writeBrowserStorageItem('kun.agentChats.selected', 'group')
    changeState({ route: 'agent-chat' })
    expect(isFocusedRoomConversation('group')).toBe(true)
    expect(isFocusedRoomConversation('private')).toBe(false)
    changeState({ route: 'chat' })
    expect(isFocusedRoomConversation('group')).toBe(false)
  })
})
