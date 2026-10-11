import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  route: 'chat', storage: new Map<string, string>(), request: vi.fn(),
  listeners: new Set<(state: { route: string }, previous: { route: string }) => void>()
}))
function setRoute(route: string): void {
  const previous = { route: harness.route }
  harness.route = route
  harness.listeners.forEach((listener) => listener({ route }, previous))
}
vi.mock('../../store/chat-store', () => ({ useChatStore: {
  getState: () => ({ route: harness.route, setRoute: (route: string) => setRoute(route) }),
  subscribe: (listener: (state: { route: string }, previous: { route: string }) => void) => {
    harness.listeners.add(listener)
    return () => harness.listeners.delete(listener)
  }
} }))
vi.mock('../../lib/browser-storage', () => ({
  readBrowserStorageItem: (key: string) => harness.storage.get(key) ?? null,
  writeBrowserStorageItem: (key: string, value: string) => harness.storage.set(key, value),
  removeBrowserStorageItem: (key: string) => harness.storage.delete(key)
}))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => '/v1/agents/' + id }))
vi.mock('./rooms-client', () => ({ roomsRequest: harness.request }))
import {
  AGENT_CHAT_SELECTED_KEY, leaveAgentConversation, openAgentConversation, openAgentConversationRoom, useAgentChatNavigationStore
} from './agent-chat-navigation'

describe('Agent private conversation navigation', () => {
  beforeEach(() => {
    setRoute('chat')
    harness.storage.clear()
    harness.request.mockReset()
    useAgentChatNavigationStore.setState({ roomId: null, pending: false, error: '', target: null })
  })
  it('opens the persistent private room without replacing the selected group', async () => {
    harness.storage.set('kun.rooms.selected', 'group')
    harness.request.mockResolvedValue({ room: { id: 'private', conversationKind: 'user_agent' } })
    await openAgentConversation('kun')
    expect(harness.request).toHaveBeenCalledWith('/v1/agents/kun/conversation', 'POST', {})
    expect(harness.route).toBe('agent-chat')
    expect(harness.storage.get(AGENT_CHAT_SELECTED_KEY)).toBe('private')
    expect(harness.storage.get('kun.rooms.selected')).toBe('group')
  })
  it('does not let a slower Agent lookup replace a newer selection', async () => {
    let resolve!: (value: unknown) => void
    harness.request.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = openAgentConversation('old')
    openAgentConversationRoom('new')
    resolve({ room: { id: 'old', conversationKind: 'user_agent' } })
    await pending
    expect(useAgentChatNavigationStore.getState().roomId).toBe('new')
  })
  it('invalidates a lookup after leaving and returning to the same route', async () => {
    let resolve!: (value: unknown) => void
    harness.request.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = openAgentConversation('old')
    setRoute('rooms')
    setRoute('agent-chat')
    resolve({ room: { id: 'old', conversationKind: 'user_agent' } })
    await pending
    expect(useAgentChatNavigationStore.getState()).toMatchObject({ roomId: null, pending: false })
  })
  it('retains source-message and historical-run targets across a route remount', () => {
    openAgentConversationRoom('dm', { runId: 'run', messageId: 'message' })
    expect(useAgentChatNavigationStore.getState().target).toEqual({ roomId: 'dm', runId: 'run', messageId: 'message' })
  })
  it('opens a conversation with its info board requested', () => {
    openAgentConversationRoom('dm', { info: true })
    expect(useAgentChatNavigationStore.getState().target).toEqual({ roomId: 'dm', info: true })
    expect(harness.route).toBe('agent-chat')
  })
  it('leaves only the removed conversation and returns Code to its task surface', async () => {
    openAgentConversationRoom('dm', { info: true })
    leaveAgentConversation('other')
    expect(useAgentChatNavigationStore.getState().roomId).toBe('dm')
    expect(harness.route).toBe('agent-chat')
    let resolve!: (value: unknown) => void
    harness.request.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = openAgentConversation('late')
    openAgentConversationRoom('dm')
    leaveAgentConversation('dm')
    expect(useAgentChatNavigationStore.getState()).toMatchObject({ roomId: null, target: null, pending: false })
    expect(harness.storage.has(AGENT_CHAT_SELECTED_KEY)).toBe(false)
    expect(harness.route).toBe('chat')
    resolve({ room: { id: 'late', conversationKind: 'user_agent' } })
    await pending
    expect(useAgentChatNavigationStore.getState().roomId).toBeNull()
  })
  it('rejects a group response and keeps the lookup failure visible', async () => {
    harness.request.mockResolvedValue({ room: { id: 'group', conversationKind: 'group' } })
    await expect(openAgentConversation('kun')).rejects.toThrow('Private conversation required')
    expect(useAgentChatNavigationStore.getState()).toMatchObject({ pending: false, roomId: null, error: 'Private conversation required' })
  })
})
