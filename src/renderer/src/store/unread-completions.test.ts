import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from './chat-store-types'
import {
  MAX_UNREAD_COMPLETION_IDS,
  LEGACY_UNREAD_COMPLETIONS_STORAGE_KEY,
  UNREAD_COMPLETIONS_STORAGE_KEY,
  clearCurrentlyVisibleUnreadCompletions,
  clearUnreadCompletion,
  completionIsCurrentlyVisible,
  markUnreadCompletion,
  normalizeUnreadCompletions,
  persistUnreadCompletions,
  readUnreadCompletions,
  retainUnreadCompletions,
  unreadCompletionCount
} from './unread-completions'

function visibilityState(overrides: Partial<ChatState> = {}) {
  return {
    route: 'chat',
    activeThreadId: 'main',
    sideConversations: {},
    sidePanel: { open: false, activeSideId: null },
    ...overrides
  } as Pick<ChatState, 'route' | 'activeThreadId' | 'sideConversations' | 'sidePanel'>
}

function storageFixture(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key))
  }
}

describe('unread completions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('normalizes, deduplicates and bounds persisted thread ids', () => {
    const ids = Array.from({ length: MAX_UNREAD_COMPLETION_IDS + 20 }, (_, index) => ` thread-${index} `)
    const normalized = normalizeUnreadCompletions({ ids: ['', ...ids, 'thread-0', 42] })

    expect(Object.keys(normalized)).toHaveLength(MAX_UNREAD_COMPLETION_IDS)
    expect(normalized['thread-0']).toBe('completed')
    expect(unreadCompletionCount(normalized)).toBe(MAX_UNREAD_COMPLETION_IDS)
  })

  it('reads valid storage and safely ignores malformed storage', () => {
    const storage = storageFixture({
      [UNREAD_COMPLETIONS_STORAGE_KEY]: JSON.stringify({ version: 1, ids: [' a ', 'a', 'b'] })
    })
    vi.stubGlobal('window', { localStorage: storage })

    expect(readUnreadCompletions()).toEqual({ a: 'completed', b: 'completed' })
    storage.getItem.mockReturnValueOnce('{bad json')
    expect(readUnreadCompletions()).toEqual({})
  })

  it('persists normalized ids and adds or clears one conversation idempotently', () => {
    const storage = storageFixture()
    vi.stubGlobal('window', { localStorage: storage })

    const one = markUnreadCompletion({}, ' thread-1 ')
    expect(markUnreadCompletion(one, 'thread-1')).toBe(one)
    expect(clearUnreadCompletion(one, 'missing')).toBe(one)
    expect(clearUnreadCompletion(one, 'thread-1')).toEqual({})
    expect(retainUnreadCompletions({ 'thread-1': true, 'thread-2': 'failed' }, ['thread-2']))
      .toEqual({ 'thread-2': 'failed' })

    persistUnreadCompletions({ 'thread-1': true, 'thread-2': false })
    expect(storage.setItem).toHaveBeenCalledWith(
      UNREAD_COMPLETIONS_STORAGE_KEY,
      JSON.stringify({ version: 2, outcomes: { 'thread-1': 'completed' } })
    )
  })

  it('migrates v1 ids and lets failure attention override completion', () => {
    const storage = storageFixture({
      [LEGACY_UNREAD_COMPLETIONS_STORAGE_KEY]: JSON.stringify({ version: 1, ids: ['legacy'] })
    })
    vi.stubGlobal('window', { localStorage: storage })

    expect(readUnreadCompletions()).toEqual({ legacy: 'completed' })
    const completed = markUnreadCompletion({}, 'thread', 'completed')
    const failed = markUnreadCompletion(completed, 'thread', 'failed')
    expect(failed).toEqual({ thread: 'failed' })
    expect(markUnreadCompletion(failed, 'thread', 'completed')).toBe(failed)
  })

  it('recognizes only the focused visible main conversation as viewed', () => {
    const state = visibilityState()

    expect(completionIsCurrentlyVisible(state, 'main', { visible: true, focused: true })).toBe(true)
    expect(completionIsCurrentlyVisible(state, 'main', { visible: false, focused: true })).toBe(false)
    expect(completionIsCurrentlyVisible(state, 'main', { visible: true, focused: false })).toBe(false)
    expect(completionIsCurrentlyVisible(visibilityState({ route: 'settings' }), 'main', {
      visible: true,
      focused: true
    })).toBe(false)
  })

  it('recognizes only the selected open side conversation as viewed', () => {
    const side = { threadId: 'side-1' } as ChatState['sideConversations'][string]
    const state = visibilityState({
      sideConversations: { 'side-1': side, 'side-2': { ...side, threadId: 'side-2' } },
      sidePanel: { open: true, activeSideId: 'side-1' }
    })
    const attention = { visible: true, focused: true }

    expect(completionIsCurrentlyVisible(state, 'side-1', attention)).toBe(true)
    expect(completionIsCurrentlyVisible(state, 'side-2', attention)).toBe(false)
    expect(clearCurrentlyVisibleUnreadCompletions(
      { main: true, 'side-1': true, 'side-2': true },
      state,
      attention
    )).toEqual({ 'side-2': 'completed' })
  })
})
