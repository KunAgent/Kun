import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { PolicyMutationRejected } from '../../domain/remote-policy-revision.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { requireAgent } from './access.js'

export class RemoteAgentLifecycle {
  constructor(private runtime: ServerRuntime) {}

  async preflight(method: string, p: any) {
    const agent = await requireAgent(this.runtime.rooms!, p.agentId)
    if (method === 'agent.restart') {
      const state = await this.runtime.rooms!.lifecycle.get(p.agentId)
      if (agent.revision !== p.expectedRevision || state.lifecycleRevision !== p.expectedLifecycleRevision)
        throw new RemoteNoEffect('REVISION_CONFLICT')
      if (!state.actions.includes('restart')) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    }
  }

  async dispatch(method: string, p: any, envelope: Envelope): Promise<unknown> {
    const clientRequestId = receiptKey(envelope, envelope.call.requestId)
    const rooms = this.runtime.rooms!
    if (method === 'agent.lifecycle.get') return rooms.lifecycle.get(p.agentId)
    try {
      const result = await rooms.lifecycle.restart({ ...p, clientRequestId })
      if (!result) throw new Error('AGENT_RESTART_PENDING')
      return result
    } catch (error) {
      if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code)
      throw error
    }
  }

  async recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method === 'agent.restart' && typeof receipt.params?.agentId === 'string') {
      return this.runtime.rooms!.lifecycle.recover(receipt.params.agentId, receiptKey(scope, receipt.requestId))
    }
    return undefined
  }
}
