import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'

/** Attachment provenance comes from durable message/request records, including settled runs. */
export async function agentAttachmentSources(runtime: ServerRuntime, roomId: string, messages: RoomMessage[]) {
  const store = runtime.rooms!.deps.store
  return Promise.all(messages.map(async (message) => {
    if (!message.attachmentIds.length) return message
    let threadId: string | undefined
    if (message.sourceRequestId) {
      const request = await store.get<RoomRequestState>('request', message.sourceRequestId)
      if (request?.roomId === roomId && request.value.sourceMessageId === message.id)
        threadId = request.value.threadId
    }
    if (!threadId && message.originRunId) {
      const run = await store.get<RoomRunRecord>('room_run', message.originRunId)
      if (run?.roomId === roomId) threadId = run.value.threadId
    }
    if (!threadId) return message
    const thread = await runtime.threadService.get(threadId)
    if (thread?.roomContext?.roomId !== roomId) return message
    return { ...message, attachmentThreadId: thread.id }
  }))
}
