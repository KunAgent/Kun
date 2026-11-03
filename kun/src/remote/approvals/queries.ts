import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { LocalCall } from '../runtime/local-call.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { directActivity } from '../../agents/agent-direct-service.js'
import { allowedThread } from '../authorization/thread-access.js'
import type { RemoteAgentConversations } from '../agents/conversations.js'
export class RemoteApprovalQueries {
  constructor(private runtime: ServerRuntime, private call: LocalCall, private conversations: RemoteAgentConversations) {}
  async dispatch(envelope: Envelope, p: any): Promise<unknown> {
    const runtime = this.runtime, rooms = runtime.rooms!, method = envelope.call.method
    switch (method) {
case 'approval.list': {
        let threadId = p.threadId
        if (p.agentId) {
          const { room } = await this.conversations.conversation(p.agentId)
          const activity = await directActivity(rooms, room.id)
          threadId = activity.active?.threadId
          if (!threadId) return { approvals: [], inputs: [] }
        }
        if (!threadId) throw new Error('INVALID_TARGET')
        await allowedThread(runtime, threadId)
        return {
          approvals: runtime.approvalGate.pending(threadId),
          inputs: runtime.userInputGate.pending(threadId)
        }
      }
case 'input.resolve': {
        const pending = runtime.userInputGate.get(p.inputId)
        if (!pending) throw new Error('INPUT_EXPIRED')
        await allowedThread(runtime, pending.threadId)
        return this.call('/v1/user-inputs/' + p.inputId, 'POST', {
          answers: p.answers
        })
      }
    }
  }
}
