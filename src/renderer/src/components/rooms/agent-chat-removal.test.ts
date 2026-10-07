import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomSidebarEntry } from '@shared/rooms-api'

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  rooms: new Map<string, { id: string; revision: number; deletedAt?: string }>(),
  agents: new Map<string, { id: string; revision: number; archivedAt?: string }>(),
  failAgentPatch: false
}))
vi.mock('./agent-client', () => ({ agentPath: (id: string) => '/v1/agents/' + id }))
vi.mock('./rooms-client', () => ({
  roomRequestId: () => 'request',
  roomsClient: {
    get: async (id: string) => ({ room: { ...harness.rooms.get(id)! } }),
    update: async (room: { id: string; revision: number }, patch: { deleted: boolean }) => {
      harness.calls.push(`room ${room.id} deleted=${patch.deleted}`)
      harness.rooms.set(room.id, { id: room.id, revision: room.revision + 1, deletedAt: patch.deleted ? 'now' : undefined })
      return { room: harness.rooms.get(room.id) }
    }
  },
  roomsRequest: async (path: string, method = 'GET', body?: { archived: boolean; expectedRevision: number }) => {
    const id = path.split('/').at(-1)!
    if (method === 'GET') return { agent: { ...harness.agents.get(id)! } }
    harness.calls.push(`agent ${id} archived=${body!.archived}`)
    if (harness.failAgentPatch) throw new Error('agent request changed')
    expect(body!.expectedRevision).toBe(harness.agents.get(id)!.revision)
    harness.agents.set(id, { id, revision: body!.expectedRevision + 1, archivedAt: body!.archived ? 'now' : undefined })
    return { agent: harness.agents.get(id) }
  }
}))
import {
  conversationRemovalError, removalTargetFromEntry, removalTargetFromRoom, removalsFor, removeConversation, restoreConversation
} from './agent-chat-removal'

const entry = (values: Partial<RoomSidebarEntry> = {}): RoomSidebarEntry => ({
  id: 'room:dm', roomId: 'dm', agentId: 'alpha', name: 'Alpha', title: '', kind: 'user_agent', members: [],
  pinned: false, archived: false, deleted: false, latestMessageSeq: 0, readSeq: 0, runningCount: 0, attentionCount: 0, ...values
})

describe('recoverable conversation removal', () => {
  beforeEach(() => {
    harness.calls = []
    harness.failAgentPatch = false
    harness.rooms = new Map([['dm', { id: 'dm', revision: 3 }], ['team', { id: 'team', revision: 1 }]])
    harness.agents = new Map([['alpha', { id: 'alpha', revision: 7 }]])
  })

  it('offers chat and Agent removal for private chats, group removal for groups and nothing for pair transcripts', () => {
    expect(removalsFor({ kind: 'user_agent', agentId: 'alpha' })).toEqual(['conversation', 'agent'])
    expect(removalsFor({ kind: 'user_agent' })).toEqual(['conversation'])
    expect(removalsFor({ kind: 'group' })).toEqual(['group'])
    expect(removalsFor({ kind: 'agent_agent', agentId: 'alpha' })).toEqual([])
    expect(removalTargetFromEntry(entry({ roomId: undefined }))).toBeNull()
    expect(removalTargetFromEntry(entry({ kind: 'group', agentId: 'stale' }))?.agentId).toBeUndefined()
  })

  it('takes the private identity from the open room and ignores removed group members', () => {
    const member = { id: 'alpha', participantAgentId: 'alpha', displayName: 'Alpha' }
    const direct = { id: 'dm', name: 'Old name', conversationKind: 'user_agent', members: [member] } as unknown as Room
    expect(removalTargetFromRoom(direct)).toMatchObject({ roomId: 'dm', name: 'Alpha', kind: 'user_agent', agentId: 'alpha' })
    const team = { id: 'team', name: 'Team', members: [member, { ...member, id: 'gone', removedAt: 'now' }] } as unknown as Room
    expect(removalTargetFromRoom(team)).toMatchObject({ kind: 'group', agentId: undefined, members: [member] })
  })

  it('deletes the chat only, or the chat before archiving its Agent', async () => {
    await removeConversation(removalTargetFromEntry(entry())!, 'conversation')
    expect(harness.calls).toEqual(['room dm deleted=true'])
    harness.rooms.set('dm', { id: 'dm', revision: 4 })
    harness.calls = []
    await removeConversation(removalTargetFromEntry(entry())!, 'agent')
    expect(harness.calls).toEqual(['room dm deleted=true', 'agent alpha archived=true'])
  })

  it('restores the chat when archiving the Agent fails so the two never drift apart', async () => {
    harness.failAgentPatch = true
    await expect(removeConversation(removalTargetFromEntry(entry())!, 'agent')).rejects.toThrow('agent request changed')
    expect(harness.calls).toEqual(['room dm deleted=true', 'agent alpha archived=true', 'room dm deleted=false'])
    expect(harness.rooms.get('dm')?.deletedAt).toBeUndefined()
  })

  it('restores a deleted Agent before its chat and skips work that is already done', async () => {
    harness.rooms.set('dm', { id: 'dm', revision: 4, deletedAt: 'then' })
    harness.agents.set('alpha', { id: 'alpha', revision: 8, archivedAt: 'then' })
    await restoreConversation(entry({ deleted: true, agentArchived: true }))
    expect(harness.calls).toEqual(['agent alpha archived=false', 'room dm deleted=false'])
    harness.calls = []
    await restoreConversation(entry({ deleted: true, agentArchived: true }))
    expect(harness.calls).toEqual([])
  })

  it('explains active-work conflicts and keeps other runtime details', () => {
    const t = (key: string) => 'translated:' + key
    expect(conversationRemovalError(new Error('stop or reconcile active work before deleting the conversation'), t))
      .toBe('translated:roomsDeleteActiveWork')
    expect(conversationRemovalError('agent not found', t)).toBe('agent not found')
  })
})
