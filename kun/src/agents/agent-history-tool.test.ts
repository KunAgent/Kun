import { afterEach, expect, it, vi } from 'vitest'
import { workbenchFixture } from '../workbench-bridge/workbench-test-support.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { RoomMessageSchema } from '../contracts/rooms.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { putRoomDocument } from '../rooms/room-service.js'
import { updateRoomRun } from '../rooms/room-run-recording.js'
import { agentHistoryTool } from './agent-history-tool.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const f = await workbenchFixture(); cleanups.push(f.cleanup)
  for (const id of ['original', 'current']) await putRoomDocument(f.store, 'message', id, f.room.id,
    RoomMessageSchema.parse({ id, roomId: f.room.id, messageSeq: 1, authorKind: 'user', authorLabelSnapshot: 'You',
      body: id === 'original' ? 'Original user decision' : 'Read the earlier decision', bodyRevision: 0,
      mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt: new Date().toISOString() }), null)
  await putRoomDocument(f.store, 'request', 'request', f.room.id, { id: 'request', roomId: f.room.id,
    sourceMessageId: 'current', threadId: f.thread.id, turnId: 'turn-1', roomSnapshot: f.room,
    status: 'running', message: { body: 'Read the earlier decision', attachmentIds: [], clientRequestId: 'req-1', executionIntent: 'auto', mentionMemberIds: [] }
  } as RoomRequestState, null)
  await updateRoomRun(f.store, f.runId, { requestId: 'request' })
  const host = new LocalToolHost({ tools: [agentHistoryTool(f.deps.threadStore)] })
  let calls = 0
  const run = async (context = f.context()) => {
    const result = await host.execute({ callId: 'read-history-' + ++calls, toolName: 'read_agent_history',
      toolKind: 'tool_call', arguments: { messageId: 'original' } }, context)
    if (result.item.kind !== 'tool_result') throw new Error('Expected tool result')
    return result.item
  }
  return { ...f, host, run }
}

it('retrieves history through LocalToolHost only for a recorded active conversation turn', async () => {
  const f = await fixture()
  expect((await f.host.listTools(f.context())).map((tool) => tool.name)).toContain('read_agent_history')
  const result = await f.run()
  expect(result.isError).not.toBe(true)
  expect(JSON.stringify(result.output)).toContain('Original user decision')
  expect((await f.run({ ...f.context(), turnId: 'forged' })).isError).toBe(true)
  await updateRoomRun(f.store, f.runId, { requestId: 'request' })
  const request = (await f.store.get<RoomRequestState>('request', 'request'))!
  await putRoomDocument(f.store, 'request', request.id, f.room.id, { ...request.value, threadId: 'another-thread' }, request)
  expect((await f.run()).isError).toBe(true)
})

it.each(['reset', 'archive', 'agent_archive', 'stop', 'turn_ended', 'aborted'] as const)('rejects a %s racing an in-flight history read', async (change) => {
  const f = await fixture()
  const controller = new AbortController()
  const get = f.store.get.bind(f.store)
  let changed = false
  vi.spyOn(f.store, 'get').mockImplementation(async (kind, id) => {
    const result = await get(kind, id)
    if (!changed && kind === 'message' && id === 'original') {
      changed = true
      if (change === 'agent_archive') {
        const agent = (await get('agent_identity', 'agent-1'))!
        await f.store.commit({ requestId: 'archive-agent-during-read',
          checks: [{ kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision }],
          puts: [{ kind: 'agent_identity', id: agent.id,
            value: { ...(agent.value as object), archivedAt: new Date().toISOString() } }] })
      } else if (change === 'stop') {
        const request = (await get<RoomRequestState>('request', 'request'))!
        await putRoomDocument(f.store, 'request', request.id, f.room.id,
          { ...request.value, cancellationRequested: true, status: 'stopping' }, request)
      } else if (change === 'turn_ended') {
        const thread = (await f.deps.threadStore.get(f.thread.id))!
        thread.turns[0].status = 'aborted'
        await f.deps.threadStore.upsert(thread)
      } else if (change === 'aborted') controller.abort()
      else {
        const room = (await get('room', f.room.id))!
        await putRoomDocument(f.store, 'room', room.id, room.id, { ...(room.value as object),
          ...(change === 'reset' ? { privateEpoch: 1 } : { archivedAt: new Date().toISOString() }) }, room)
      }
    }
    return result
  })
  const result = await f.run({ ...f.context(), abortSignal: controller.signal })
  expect(result.isError).toBe(true)
  expect(JSON.stringify(result.output)).not.toContain('Original user decision')
})
