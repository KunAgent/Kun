import { describe, it, expect, vi } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { workboardSnapshot } from './snapshot.js'
import { createApprovalRequest } from '../../domain/approval.js'
import { openAgentConversation } from '../../agents/agent-conversations.js'
import { putRoomDocument } from '../../rooms/room-service.js'
import type { RoomRequestState } from '../../rooms/room-runtime-types.js'
import { RoomThreadContextSchema } from '../../contracts/thread-room-context.js'
describe('workboard durable metadata projection', () => {
  it('projects one human-blocked Code execution without items, text or hidden worker sessions', async () => {
    const f = await remoteFixture()
    try {
      const thread = await f.code('Private project title'), turn = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'private instructions' } })
      const gate = createApprovalRequest({ id: 'approval', threadId: thread.id, turnId: turn.turnId, toolName: 'fixture', summary: 'secret command' })
      const pending = f.h.approvalGate.request(gate)
      const child = await f.code(); await f.h.threadStore.upsert({ ...child, parentThreadId: 'parent' })
      const fullHistory = vi.spyOn(f.h.threads, 'get').mockRejectedValue(new Error('item histories must not be loaded'))
      const snapshot = await workboardSnapshot(f.runtime)
      expect(snapshot.sessions).toHaveLength(1)
      expect(snapshot.sessions[0]).toMatchObject({ id: thread.id, runId: turn.turnId, phase: 'approval', kind: 'code' })
      expect(JSON.stringify(snapshot)).not.toMatch(/private|secret|Private/)
      expect(fullHistory).not.toHaveBeenCalled(); fullHistory.mockRestore()
      f.h.approvalGate.decide(gate.id, 'deny'); await pending
      await f.h.turns.finishTurn({ threadId: thread.id, turnId: turn.turnId, status: 'completed' })
      expect((await workboardSnapshot(f.runtime)).sessions[0].phase).toBe('completed')
      expect((await f.h.threads.getMetadata(thread.id))?.turns).toHaveLength(1)
      await f.h.threads.setGoal(thread.id, { objective: 'keep going' })
      expect((await workboardSnapshot(f.runtime)).sessions[0].phase).toBe('running')
    } finally { await f.close() }
  })
  it('counts a personal Agent conversation once and follows its durable request finality', async () => {
    const f = await remoteFixture()
    try {
      const agent = (await f.rooms.agents.create({ clientRequestId: 'agent', name: 'private agent' })).agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const sent = await f.rooms.service.send(room.id, { clientRequestId: 'source', body: 'private message' })
      const before = await workboardSnapshot(f.runtime)
      expect(before.sessions.filter(row => row.kind === 'agent')).toHaveLength(1)
      expect(before.sessions.find(row => row.kind === 'agent')).toMatchObject({ id: agent.id, phase: 'running', runId: sent.requestId })
      const row = (await f.store.get<RoomRequestState>('request', sent.requestId))!
      await putRoomDocument(f.store, 'request', row.id, room.id, { ...row.value, status: 'completed' }, row)
      const after = await workboardSnapshot(f.runtime)
      expect(after.sessions.find(row => row.kind === 'agent')?.phase).toBe('completed')
      expect(JSON.stringify(after)).not.toContain('private message')
    } finally { await f.close() }
  })
  it('shows the active request ahead of queued messages and excludes agent-reviewed approvals', async () => {
    const f = await remoteFixture()
    try {
      const agent = (await f.rooms.agents.create({ clientRequestId: 'queued-agent', name: 'Agent' })).agent
      const { room } = await openAgentConversation(f.rooms.agents, f.rooms.service, agent.id)
      const first = await f.rooms.service.send(room.id, { clientRequestId: 'first', body: 'first private request' })
      await f.rooms.service.send(room.id, { clientRequestId: 'queued', body: 'queued private request' })
      const thread = await f.code(), started = await f.h.turns.startTurn({ threadId: thread.id, request: { prompt: 'work' } })
      const record = (await f.h.threads.getMetadata(thread.id))!
      await f.h.threadStore.upsert({ ...record, roomContext: RoomThreadContextSchema.parse({ kind: 'conversation', roomId: room.id, memberId: room.defaultMemberId, participantAgentId: agent.id }),
        turns: record.turns.map(turn => ({ ...turn, approvalReviewer: 'agent' as const })) })
      const row = (await f.store.get<RoomRequestState>('request', first.requestId))!
      await putRoomDocument(f.store, 'request', row.id, room.id, { ...row.value, status: 'running', threadId: thread.id, turnId: started.turnId }, row)
      const gate = createApprovalRequest({ id: 'agent-review', threadId: thread.id, turnId: started.turnId, toolName: 'fixture', summary: 'not for the user' })
      const pending = f.h.approvalGate.request(gate)
      const snapshot = await workboardSnapshot(f.runtime)
      expect(snapshot.sessions).toHaveLength(1)
      expect(snapshot.sessions[0]).toMatchObject({ id: agent.id, runId: first.requestId, phase: 'running' })
      f.h.approvalGate.decide(gate.id, 'deny'); await pending
    } finally { await f.close() }
  })
})
