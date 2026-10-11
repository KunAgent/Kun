import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { RoomMessage, Room } from '../contracts/rooms.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { roomPeerStoreBinding } from '../rooms/room-peer-tools.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { boundedRoomText } from '../rooms/room-context.js'
import { advertiseWorkbenchTool, workbenchToolMeta, workbenchFail } from '../workbench-bridge/tool-scope.js'
import { conversationMessageScope } from './agent-conversation-history.js'
import { ROOM_AX_TOOL_DESCRIPTIONS } from '../rooms/room-ax-surfaces.js'

const Input = z.object({
  messageId: z.string().min(1).max(256).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  beforeSeq: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(20).default(10)
}).strict()

export async function agentHistoryPage(store: RoomStore, request: RoomRequestState, raw: unknown) {
  const input = Input.parse(raw), source = await store.get('message', request.sourceMessageId)
  if (!source || source.roomId !== request.roomId) throw new Error('Conversation source unavailable')
  const rows = input.messageId ? [await store.get<RoomMessage>('message', input.messageId)].filter((row) => row !== null) :
    await store.list<RoomMessage>('message', { roomId: request.roomId, beforeSeq: input.beforeSeq,
      search: input.search, beforeSourceSeq: source.seq, limit: input.limit, order: 'desc' })
  const messages: Array<{ id: string; seq: number; author: string; status: string; text: string; offset: number; nextOffset?: number }> = []
  let budget = 6000, nextBeforeSeq: number | undefined
  for (const row of rows) {
    const scope = await conversationMessageScope(store, request, row, source.seq)
    if (!scope || row.value.status === 'streaming') { nextBeforeSeq = row.seq; continue }
    // Text offsets are UTF-16 offsets, compatible with String.slice. Avoid
    // splitting surrogate pairs, and budget the encoded JSON, not just prose.
    let offset = input.messageId ? Math.min(input.offset, row.value.body.length) : 0
    if (offset > 0 && /[\uDC00-\uDFFF]/.test(row.value.body[offset] ?? '')) offset--
    const text = boundedRoomText(row.value.body.slice(offset), Math.min(input.messageId ? 4000 : 400, Math.floor(budget / 2)))
    const item = { id: row.id, seq: row.seq, author: row.value.authorLabelSnapshot,
      status: scope.origin ? `${row.value.status}; request ${scope.origin.status}` : row.value.status ?? 'final',
      text, offset, ...(offset + text.length < row.value.body.length ? { nextOffset: offset + text.length } : {}) }
    let bytes = Buffer.byteLength(JSON.stringify(item))
    // One heavily escaped original must still be readable with a fresh budget.
    while (bytes > budget && messages.length === 0 && item.text) {
      item.text = boundedRoomText(item.text, Math.floor(Buffer.byteLength(item.text) / 2))
      item.nextOffset = offset + item.text.length
      bytes = Buffer.byteLength(JSON.stringify(item))
    }
    if (bytes > budget) break
    messages.push(item); budget -= bytes; nextBeforeSeq = row.seq
  }
  if (input.messageId && !messages.length) throw new Error('Message is outside this conversation snapshot')
  return { referenceOnly: true, messages,
    ...(!input.messageId && nextBeforeSeq !== undefined ? { nextBeforeSeq } : {}) }
}

async function activeHistoryScope(threads: ThreadStore, context: ToolHostContext) {
  context.abortSignal.throwIfAborted()
  const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  const scope = thread?.roomContext, store = roomPeerStoreBinding(threads)
  const turn = thread?.turns.find((item) => item.id === context.turnId)
  if (!store || !thread || scope?.kind !== 'conversation' || !scope.participantAgentId ||
    !turn?.clientRequestId || turn.status !== 'running') throw new Error('Active private Agent turn required')
  const run = await store.get<RoomRunRecord>('room_run', roomRunId(scope.roomId, turn.clientRequestId))
  const request = run?.value.requestId ? await store.get<RoomRequestState>('request', run.value.requestId) : null
  const room = await store.get<Room>('room', scope.roomId)
  const agent = await store.get<{ archivedAt?: string }>('agent_identity', scope.participantAgentId)
  const member = room?.value.members.find((item) => item.id === scope.memberId)
  if (!request || request.roomId !== scope.roomId || request.value.threadId !== thread.id ||
    request.value.cancellationRequested || request.value.status !== 'running' || !agent || agent.value.archivedAt ||
    run?.roomId !== scope.roomId || run.value.threadId !== thread.id ||
    run.value.memberId !== scope.memberId || run.value.participantAgentId !== scope.participantAgentId ||
    run?.value.turnId !== turn.id || room?.value.conversationKind !== 'user_agent' || room.value.archivedAt ||
    !member?.enabled || member.removedAt || member.participantAgentId !== scope.participantAgentId ||
    (room.value.privateEpoch ?? 0) !== (request.value.roomSnapshot.privateEpoch ?? 0)) {
    throw new Error('Conversation history scope is no longer current')
  }
  context.abortSignal.throwIfAborted()
  return { store, request, room, agent }
}

export function agentHistoryTool(threads: ThreadStore) {
  return LocalToolHost.defineTool({ ...workbenchToolMeta, name: 'read_agent_history',
    description: ROOM_AX_TOOL_DESCRIPTIONS.read_agent_history,
    shouldAdvertise: advertiseWorkbenchTool, inputSchema: z.toJSONSchema(Input) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const initial = await activeHistoryScope(threads, context)
        const output = await agentHistoryPage(initial.store, initial.request.value, args)
        // Reset/archive, Stop, or turn termination can revoke separate records
        // during a paged read. Revalidate all live authority before returning.
        const current = await activeHistoryScope(threads, context)
        if (current.room.id !== initial.room.id || current.room.revision !== initial.room.revision ||
          current.agent.id !== initial.agent.id || current.request.id !== initial.request.id ||
          current.request.value.sourceMessageId !== initial.request.value.sourceMessageId) {
          throw new Error('Conversation history scope changed while reading')
        }
        return { output }
      } catch (error) { return workbenchFail(error) }
    }
  })
}
