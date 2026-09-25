import { roomRunId } from '../rooms/room-run-recording.js'
import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { RoomPeerTopic, RoomPeerMemberState } from '../rooms/room-peer-types.js'
import { agentStableId } from './agent-identity-service.js'
import type { AgentHandoffService, HandoffOrigin } from './agent-handoff-service.js'
import { RoomPeerMessageInput } from '../rooms/room-peer-tools.js'
import { ROOM_AX_TOOL_DESCRIPTIONS } from '../rooms/room-ax-surfaces.js'

const bindings = new WeakMap<ThreadStore, AgentHandoffService>()
export const bindAgentHandoffService = (threads: ThreadStore, service: AgentHandoffService) => bindings.set(threads, service)
export const AGENT_COLLABORATION_TOOLS = ['list_collaboration_agents', 'send_agent_message', 'get_agent_handoff'] as const
const Id = z.string().min(1).max(128)
async function boundOrigin(threads: ThreadStore, context: ToolHostContext): Promise<{ service: AgentHandoffService; origin: HandoffOrigin }> {
  const service = bindings.get(threads)
  let thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
  if (thread?.roomContext?.kind === 'conversation') {
    const turn = thread.turns.find((item) => item.id === context.turnId)
    const run = turn?.clientRequestId && service ? await service.deps.store.get<import('../contracts/room-runs.js').RoomRunRecord>('room_run', roomRunId(thread.roomContext.roomId, turn.clientRequestId)) : null
    if (!run || run.value.threadId !== thread.id || run.value.turnId !== context.turnId) throw new Error('Private run binding unavailable')
    thread = { ...thread, roomContext: { ...thread.roomContext, requestId: run.value.requestId, rootRequestId: run.value.rootRequestId } }
  }
  const scope = thread?.roomContext
  const turn = thread?.turns.find((turn) => turn.id === context.turnId)
  if (!service) throw new Error('agent collaboration service binding unavailable')
  if (!thread || !scope?.participantAgentId) throw new Error('persistent agent identity required')
  if (!turn || turn.status !== 'running') throw new Error('active agent turn required')
  const parent = scope.handoffId ? await service.get(scope.handoffId) : undefined
  if (!parent && scope.requestId) {
    const request = await service.deps.store.get<RoomRequestState>('request', scope.requestId)
    const rootId = request?.value.rootRequestId ?? scope.requestId
    const topic = await service.deps.store.get<RoomPeerTopic>('peer_topic', rootId)
    if (!request || request.value.cancellationRequested || ['stopping', 'cancelled'].includes(request.value.status) ||
      topic && (topic.value.requestId !== scope.requestId || ['stopping', 'stopped'].includes(topic.value.status))) {
      throw new Error('source request is no longer current')
    }
    if (scope.kind === 'discussion' && scope.collaborationProtocol === 'peer') {
      const members = await service.deps.store.list<RoomPeerMemberState>('peer_member', {
        roomId: scope.roomId, rootRequestId: rootId, memberId: scope.memberId, limit: 1 })
      const activation = members[0]?.value.activation
      if (!activation || activation.threadId !== thread.id || activation.clientRequestId !== turn.clientRequestId ||
        activation.generation !== topic?.value.generation) throw new Error('source activation is no longer current')
    }
  }
  if (parent && (parent.recipientAgentId !== scope.participantAgentId || parent.threadId !== thread.id ||
    parent.clientTurnId !== turn.clientRequestId || parent.status !== 'running' || !await service.current(parent.id))) {
    throw new Error('handoff activation is no longer current')
  }
  return { service, origin: { thread, turnId: turn.id, parent } }
}
export async function executeAgentHandoffRoomTool(threads: ThreadStore, name: string, args: unknown, context: ToolHostContext) {
  const { service, origin } = await boundOrigin(threads, context)
  const job = origin.parent
  if (!job) throw new Error('scoped handoff required')
  if (name === 'send_room_message') {
    const value = RoomPeerMessageInput.parse(args)
    if (value.mentionMemberIds.length || value.inviteMemberIds.length || value.replyToMessageId) {
      throw new Error('reply targets are host-bound; use send_agent_message for a new handoff')
    }
    return { output: { accepted: true, staged: true, value } }
  }
  z.object({}).strict().parse(args)
  return { output: { handoffId: job.id, request: job.body, sources: job.sources,
    note: 'Only the evidence granted to this handoff is available. Other pair-conversation history is excluded.' } }
}
export function agentHandoffTools(threads: ThreadStore) {
  const list = z.object({ query: z.string().max(200).optional() }).strict()
  const send = z.object({ recipientAgentId: Id, body: z.string().trim().min(1).max(8000),
    sourceMessageIds: z.array(Id).max(8).default([]) }).strict()
  const get = z.object({ handoffId: Id }).strict()
  return [
    { name: 'list_collaboration_agents', schema: list, description: ROOM_AX_TOOL_DESCRIPTIONS.list_collaboration_agents },
    { name: 'send_agent_message', schema: send, description: ROOM_AX_TOOL_DESCRIPTIONS.send_agent_message },
    { name: 'get_agent_handoff', schema: get, description: ROOM_AX_TOOL_DESCRIPTIONS.get_agent_handoff }
  ].map(({ name, schema, description }) => LocalToolHost.defineTool({
    name, description, toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => context.roomAgent === true,
    inputSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const { service, origin } = await boundOrigin(threads, context)
        if (!(await service.agents.features()).collaboration) throw new Error('agent collaboration is disabled')
        const actor = origin.thread.roomContext!.participantAgentId!
        const requestId = origin.thread.roomContext!.requestId
        const request = requestId ? await service.deps.store.get<RoomRequestState>('request', requestId) : null
        const sourceRoomId = origin.parent?.sourceRoomId ?? origin.thread.roomContext!.roomId
        const sourceRootRequestId = origin.parent?.sourceRootRequestId ?? request?.value.rootRequestId ?? requestId
        if (!sourceRootRequestId) throw new Error('source request required')
        if (name === 'list_collaboration_agents') {
          const { query } = list.parse(args)
          const ids = await service.permitted(origin)
          const result = []
          for (const id of ids) {
            if (id === actor) continue
            const agent = await service.agents.get(id)
            if (!agent.archivedAt && (!query || (agent.name + ' ' + agent.title).toLocaleLowerCase().includes(query.toLocaleLowerCase()))) {
              result.push({ id, name: agent.name, title: agent.title })
            }
            if (result.length >= 30) break
          }
          return { output: { agents: result } }
        }
        if (name === 'send_agent_message') {
          const value = send.parse(args)
          const result = await service.create({ ...value, sourceRoomId, sourceRootRequestId, senderAgentId: actor,
            parentHandoffId: origin.parent?.id, clientRequestId: agentStableId('handoff-call', context.threadId, context.turnId, value.recipientAgentId, value.body, JSON.stringify(value.sourceMessageIds)) }, origin)
          return { output: { accepted: true, handoffId: result.handoff.id, status: result.handoff.status,
            conversationId: result.handoff.pairRoomId } }
        }
        const job = await service.get(get.parse(args).handoffId)
        if (job.sourceRoomId !== sourceRoomId || job.sourceRootRequestId !== sourceRootRequestId ||
          job.senderAgentId !== actor && job.recipientAgentId !== actor ||
          origin.parent && job.chainId !== origin.parent.chainId) throw new Error('handoff is outside this work scope')
        return { output: { handoffId: job.id, status: job.status, result: job.result?.slice(0, 8000), error: job.error } }
      } catch (error) { return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } } }
    }
  }))
}
