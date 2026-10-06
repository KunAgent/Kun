import { describe, expect, it } from 'vitest'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { conversationHasUnread, conversationSidebarQuery, visibleAgentChatEntries } from './sidebar-agent-chats'
import { publishRoomActivityCounts, useRoomActivityCounts } from '../rooms/room-activity-counts'

function entry(id: string, values: Partial<RoomSidebarEntry> = {}): RoomSidebarEntry {
  return { id, name: id, title: id, roomId: `room-${id}`, kind: 'user_agent', members: [], pinned: false,
    archived: false, deleted: false, latestMessageSeq: 0, readSeq: 0, runningCount: 0, attentionCount: 0, ...values }
}

describe('Code conversation list helpers', () => {
  it('queries private and group conversations with the chosen filter and list state', () => {
    expect(conversationSidebarQuery('active', 'all', '')).toEqual({ kind: 'all', search: '' })
    expect(conversationSidebarQuery('active', 'unread', 'x')).toEqual({ kind: 'all', search: 'x', unreadOnly: true })
    expect(conversationSidebarQuery('active', 'attention', '')).toEqual({ kind: 'all', search: '', attentionOnly: true })
    expect(conversationSidebarQuery('active', 'group', '')).toEqual({ kind: 'group', search: '' })
    expect(conversationSidebarQuery('archived', 'all', '')).toEqual({ kind: 'all', search: '', archivedOnly: true })
    expect(conversationSidebarQuery('deleted', 'all', '')).toEqual({ kind: 'all', search: '', deletedOnly: true })
  })

  it('shows four conversations, keeps the selected one visible and leaves Agent pairs out', () => {
    const entries = [entry('a'), entry('pair', { kind: 'agent_agent' }), entry('b', { kind: 'group' }),
      entry('c'), entry('d'), entry('e')]
    expect(visibleAgentChatEntries(entries, false, '', null).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(visibleAgentChatEntries(entries, false, '', 'room-e').map((item) => item.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(visibleAgentChatEntries(entries, true, '', null).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(visibleAgentChatEntries([entry('gone', { deleted: true })], false, '', null)).toEqual([])
    expect(visibleAgentChatEntries([entry('gone', { deleted: true })], false, '', null, true)).toHaveLength(1)
  })

  it('treats sequence gaps only as an unread marker', () => {
    expect(conversationHasUnread(entry('a', { latestMessageSeq: 9, readSeq: 2 }))).toBe(true)
    expect(conversationHasUnread(entry('a', { latestMessageSeq: 2, readSeq: 2 }))).toBe(false)
    expect(conversationHasUnread(entry('a', { latestMessageSeq: 9, readSeq: 2, deleted: true }))).toBe(false)
  })

  it('publishes host activity counts only when they change', () => {
    useRoomActivityCounts.setState({ counts: {} })
    publishRoomActivityCounts([entry('a', { runningCount: 1 }), entry('b', { roomId: undefined, attentionCount: 3 })])
    const first = useRoomActivityCounts.getState().counts
    expect(first).toEqual({ 'room-a': { runningCount: 1, attentionCount: 0 } })
    publishRoomActivityCounts([entry('a', { runningCount: 1 })])
    expect(useRoomActivityCounts.getState().counts).toBe(first)
    publishRoomActivityCounts([entry('a', { attentionCount: 2 })])
    expect(useRoomActivityCounts.getState().counts['room-a']).toEqual({ runningCount: 0, attentionCount: 2 })
  })
})
