import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { LocalCall } from '../runtime/local-call.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { controlDirectRequest } from '../../agents/agent-direct-service.js'
import { requireCode } from '../code/access.js'
import type { RemoteAgentConversations } from '../agents/conversations.js'
export class RemoteExecutionStop {
  constructor(private runtime: ServerRuntime, private call: LocalCall, private conversations: RemoteAgentConversations) {}
  async stop(envelope: Envelope, p: any) {
    const runtime = this.runtime, rooms = runtime.rooms!, requestId = envelope.call.requestId
    {
        if (p.agentId) {
          const { room } = await this.conversations.conversation(p.agentId),
            target = await rooms.deps.store.get('request', p.executionId)
          if (!target || target.roomId !== room.id)
            throw new Error('INVALID_TARGET')
          return rooms.exclusive(() =>
            controlDirectRequest(rooms, room.id, target.id, {
              clientRequestId: receiptKey(envelope, requestId),
              expectedRevision: target.revision,
              action: 'stop'
            })
          )
        }
        if (!p.threadId || !p.turnId) throw new Error('INVALID_TARGET')
        await requireCode(runtime, p.threadId)
        return this.call(
          '/v1/threads/' + p.threadId + '/turns/' + p.turnId + '/interrupt',
          'POST',
          {}
        )
      }
  }
}
