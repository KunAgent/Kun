import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { useActivityStore } from './activity-store'
import { appBadgeInputFromChatState, attentionItemsForBadge } from './app-badge'
import { markAttentionRead, type AttentionReadUndo } from './attention-read-actions'
import { useChatStore } from './chat-store'

function thread(id: string, patch: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    id,
    title: `Thread ${id}`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    ...patch
  } as NormalizedThread
}

const initialChat = useChatStore.getState()
const initialActivity = useActivityStore.getState()
let batch: AttentionReadUndo | null = null

describe('markAttentionRead', () => {
  beforeEach(() => {
    useActivityStore.setState({ rows: {} })
    useChatStore.setState({
      threads: [],
      route: 'chat',
      activeThreadId: null,
      busy: false,
      watchTurnCompletion: {},
      unreadThreadIds: {},
      awaitingUserInputThreadIds: {},
      scheduledThreadActivities: {},
      writeAssistantVisibleThreadId: null,
      sidePanel: { ...initialChat.sidePanel, open: false, activeSideId: null }
    })
  })

  afterEach(() => {
    batch?.dispose()
    batch = null
    useChatStore.setState(initialChat, true)
    useActivityStore.setState(initialActivity, true)
  })

  it('clears all requested ordinary unread rows, not failures, questions, active work or other threads', () => {
    const unread = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const others = ['failed', 'asked', 'running', 'archived', 'not-requested']
    useChatStore.setState({
      threads: [...unread, ...others].map((id) => thread(id, { archived: id === 'archived' })),
      unreadThreadIds: {
        ...Object.fromEntries(unread.map((id) => [id, 'completed' as const])),
        failed: 'failed', asked: 'completed', running: 'completed', archived: 'completed',
        'not-requested': 'completed'
      },
      awaitingUserInputThreadIds: { asked: true },
      watchTurnCompletion: { running: true }
    })

    batch = markAttentionRead([...unread, 'failed', 'asked', 'running', 'archived', 'missing'])

    expect(batch?.count).toBe(8)
    expect(useChatStore.getState().unreadThreadIds).toEqual({
      failed: 'failed', asked: 'completed', running: 'completed', archived: 'completed',
      'not-requested': 'completed'
    })
    const input = appBadgeInputFromChatState(useChatStore.getState(), useActivityStore.getState().rows)
    expect(attentionItemsForBadge(input).map((item) => [item.threadId, item.kind])).toEqual([
      ['asked', 'awaiting-input'], ['failed', 'failed'], ['not-requested', 'unread']
    ])
    batch!.undo()
    expect(useChatStore.getState().unreadThreadIds).toMatchObject(
      Object.fromEntries(unread.map((id) => [id, 'completed']))
    )
  })

  it('revalidates the latest state rather than clearing stale or unrequested ids', () => {
    useChatStore.setState({
      threads: [thread('changed'), thread('question'), thread('new')],
      unreadThreadIds: { changed: 'failed', question: 'completed', new: 'completed' },
      awaitingUserInputThreadIds: { question: true }
    })
    expect(markAttentionRead(['changed', 'question'])).toBeNull()
    expect(useChatStore.getState().unreadThreadIds).toEqual({
      changed: 'failed', question: 'completed', new: 'completed'
    })
  })

  it('undo never overwrites newer outcomes or resurrects threads visited, waiting, running or archived in the meantime', () => {
    const ids = ['failed-again', 'visited', 'new-then-read', 'asked', 'running', 'archived', 'safe']
    const threads = ids.map((id) => thread(id))
    useChatStore.setState({
      threads,
      unreadThreadIds: Object.fromEntries(ids.map((id) => [id, 'completed' as const]))
    })
    batch = markAttentionRead(ids)
    expect(batch?.count).toBe(ids.length)

    useChatStore.setState({ unreadThreadIds: { 'failed-again': 'failed', 'new-then-read': 'completed', fresh: 'completed' } })
    useChatStore.setState({ unreadThreadIds: { 'failed-again': 'failed', fresh: 'completed' } })
    useChatStore.setState({ activeThreadId: 'visited' })
    useChatStore.setState({ activeThreadId: null })
    useChatStore.setState({ awaitingUserInputThreadIds: { asked: true }, watchTurnCompletion: { running: true } })
    useChatStore.setState({ awaitingUserInputThreadIds: {}, watchTurnCompletion: {} })
    useChatStore.setState({ threads: threads.map((item) => item.id === 'archived' ? { ...item, archived: true } : item) })
    useChatStore.setState({ threads })

    batch!.undo()
    expect(useChatStore.getState().unreadThreadIds).toEqual({
      'failed-again': 'failed', fresh: 'completed', safe: 'completed'
    })
    batch!.undo()
    expect(useChatStore.getState().unreadThreadIds).toEqual({
      'failed-again': 'failed', fresh: 'completed', safe: 'completed'
    })
  })

  it('does not restore after the undo window is disposed', () => {
    useChatStore.setState({ threads: [thread('a')], unreadThreadIds: { a: 'completed' } })
    batch = markAttentionRead(['a'])
    batch!.dispose()
    batch!.undo()
    expect(useChatStore.getState().unreadThreadIds).toEqual({})
  })
})
