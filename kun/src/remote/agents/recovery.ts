import { createHash } from 'node:crypto'
import { agentStableId } from '../../agents/agent-identity-service.js'
import { AgentMemoryWrite } from '../../agents/agent-memory-service.js'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { AgentParamSchemas } from './contracts.js'
import { publicAgentMemory } from './memory/service.js'
import { publicAgent } from './access.js'
import { decisionInput, decisionResult } from './memory/content-window.js'
/** Read existing runtime receipts only. Recovery never dispatches a mutation. */
export async function recoverAgentOperation(rooms: RoomRuntime, scope: RemoteScope, receipt: Receipt): Promise<unknown | undefined> {
  if (!receipt.params || !Object.hasOwn(AgentParamSchemas, receipt.method)) return undefined
  const method = receipt.method as keyof typeof AgentParamSchemas
  const parsed = AgentParamSchemas[method].safeParse(receipt.params)
  if (!parsed.success) return undefined
  const p = parsed.data as any, clientId = receiptKey(scope, receipt.requestId)
  if (method === 'agent.memory.candidates.decide') {
    const input = decisionInput(p, clientId), key = agentStableId('agent-memory-decision', p.candidateId, clientId)
    const proof = await rooms.deps.store.getRequest(key)
    const candidate = (proof?.result as any)?.candidate
    if (proof?.fingerprint !== createHash('sha256').update(JSON.stringify(input)).digest('hex') ||
      candidate?.id !== p.candidateId || candidate.participantAgentId !== p.agentId ||
      candidate.status !== (p.decision === 'accept' ? 'completed' : 'skipped')) return undefined
    return decisionResult(candidate, p.expectedRevision)
  }
  let requestId: string | undefined
  if (method === 'agent.create') requestId = 'agent-create:' + clientId
  else if (['agent.update', 'agent.archive', 'agent.restore'].includes(method)) requestId = 'agent-update:' + p.agentId + ':' + clientId
  else if (method === 'agent.memory.update') {
    if (p.action === 'create') {
      const input = AgentMemoryWrite.parse({ clientRequestId: clientId, conversationId: p.roomId,
        sourceMessageIds: p.sourceMessageIds, content: p.content, type: p.type, shared: false })
      const id = agentStableId('mem-agent', p.agentId, clientId)
      const memory = await rooms.agentMemory.find(p.agentId, id).catch(() => null)
      if (memory?.agentContext?.originFingerprint === createHash('sha256').update(JSON.stringify(input)).digest('hex'))
        return { memory: publicAgentMemory(memory) }
      return undefined
    }
    requestId = agentStableId('agent-memory-edit', p.agentId, p.memoryId, clientId)
  } else if (method === 'agent.commitments.act') requestId = p.action === 'create'
    ? agentStableId('commitment', p.agentId, clientId) + ':create' : p.commitmentId + ':update:' + clientId
  if (!requestId) return undefined
  const result = (await rooms.deps.store.getRequest(requestId))?.result as any
  if (!result) return undefined
  if (method === 'agent.create' || method === 'agent.update' || method === 'agent.archive' || method === 'agent.restore')
    return result.agent ? { agent: publicAgent(result.agent) } : undefined
  if (method === 'agent.commitments.act') return { commitment: result }
  if (p.action === 'forget') return { memoryId: p.memoryId, forgotten: true }
  return result.memory ? { memory: publicAgentMemory(result.memory, result.fingerprint) } : undefined
}
