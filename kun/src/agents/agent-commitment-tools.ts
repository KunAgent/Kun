import { roomAxToolDescription } from '../rooms/room-ax-surfaces.js'
import { z } from 'zod'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import { AgentCommitmentFields, AgentCommitmentQuery, UpdateAgentCommitment } from '../contracts/agent-commitments.js'
import { advertiseWorkbenchTool, workbenchFail, workbenchToolMeta, workbenchToolScope } from '../workbench-bridge/tool-scope.js'
import type { AgentCommitmentService } from './agent-commitment-service.js'

const bindings = new WeakMap<ThreadStore, AgentCommitmentService>()
export const bindAgentCommitmentService = (threads: ThreadStore, service: AgentCommitmentService) => bindings.set(threads, service)
export { AGENT_COMMITMENT_TOOLS } from '../contracts/agent-work-tools.js'
const Id = z.string().min(1).max(256)
const Get = z.object({ id: Id }).strict()
const Update = UpdateAgentCommitment.omit({ clientRequestId: true }).extend({ id: Id }).strict()
const Cancel = Get.extend({ expectedRevision: z.number().int().nonnegative() }).strict()
export function agentCommitmentTools(threads: ThreadStore) {
  return [
    { name: 'create_agent_commitment', schema: AgentCommitmentFields,
      description: roomAxToolDescription('create_agent_commitment') },
    { name: 'list_agent_commitments', schema: AgentCommitmentQuery,
      description: roomAxToolDescription('list_agent_commitments') },
    { name: 'get_agent_commitment', schema: Get, description: roomAxToolDescription('get_agent_commitment') },
    { name: 'update_agent_commitment', schema: Update,
      description: roomAxToolDescription('update_agent_commitment') },
    { name: 'cancel_agent_commitment', schema: Cancel,
      description: roomAxToolDescription('cancel_agent_commitment') }
  ].map(({ name, schema, description }) => LocalToolHost.defineTool({ ...workbenchToolMeta, name, description,
    shouldAdvertise: advertiseWorkbenchTool, inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const service = bindings.get(threads)
        if (!service) throw new Error('commitment service unavailable')
        const scope = await workbenchToolScope(threads, context, { needsToolCall: !['list_agent_commitments', 'get_agent_commitment'].includes(name) })
        const agentId = scope.agent.agentId
        if (name === 'list_agent_commitments') return { output: await service.list(agentId, args) }
        if (name === 'get_agent_commitment') return { output: await service.get(agentId, Get.parse(args).id) }
        const clientRequestId = `${scope.runId}:${scope.toolCallId}`
        if (name === 'create_agent_commitment') {
          const run = await scope.store.get<RoomRunRecord>('room_run', scope.runId)
          const request = scope.requestId ? await scope.store.get<RoomRequestState>('request', scope.requestId) : null
          const sourceMessageId = request?.value.originalSourceMessageId ?? request?.value.sourceMessageId ?? run?.value.triggerMessageId
          if (!sourceMessageId) throw new Error('user request provenance unavailable')
          return { output: await service.create(agentId, { ...AgentCommitmentFields.parse(args), clientRequestId,
            sourceRoomId: scope.roomId, sourceMessageId }) }
        }
        const { id, ...input } = name === 'cancel_agent_commitment' ? Cancel.parse(args) : Update.parse(args)
        return { output: await service.update(agentId, id, { ...input, clientRequestId,
          ...(name === 'cancel_agent_commitment' ? { status: 'cancelled' } : {}) }) }
      } catch (error) { return workbenchFail(error) }
    }
  }))
}
