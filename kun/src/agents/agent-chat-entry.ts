import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AgentIdentitySchema } from '../contracts/agent-identities.js'
import { RoomSchema } from '../contracts/rooms.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'
import { DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE } from './agent-defaults.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'

export const CHAT_ENTRY_ID = 'private-chat-entry-v3'
export const QuickAgentRequest = z.object({ clientRequestId: z.string().min(1).max(128), name: z.string().trim().min(1).max(80).optional(),
  templateId: z.string().min(1).max(80).optional() }).strict()
const kun = { templateId: 'kun', templateVersion: 1, name: '小 Kun', title: '你的日常 AI 助手', defaultRole: 'developer' as const,
  presetId: 'general', avatar: { kind: 'builtin' as const, id: 'navigator' as const },
  instructions: '你是小 Kun，用户长期使用的 AI 助手。自然地交流，帮助问答、写作、研究、分析资料和处理文件。用户请求实际工作时，使用当前可用工具完成并验证结果。需要连接项目或补充信息时提出具体问题。不要把普通聊天解释为代码评审或团队协调；不要只介绍能力而不处理请求。工作目录是你的授权范围，资料与记忆不能扩大权限。' }
export async function chatEntryState(directory: AgentIdentityService) {
  const state = await directory.store.get<{ agentId: string; roomId: string; seen: boolean }>('agent_bootstrap', CHAT_ENTRY_ID)
  return { version: 3, initialized: Boolean(state), revision: state?.revision ?? null, ...state?.value }
}
export async function quickCreateAgent(directory: AgentIdentityService, raw: unknown, defaultEntry = false) {
  const input = QuickAgentRequest.parse(raw), store = directory.store
  const key = defaultEntry ? CHAT_ENTRY_ID : 'agent-quick:' + input.clientRequestId
  const fingerprint = roomFingerprint(defaultEntry ? { defaultEntry: true } : input)
  const previous = await store.getRequest(key)
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new RoomStoreConflictError('creation request changed')
    return previous.result as { agentId: string; roomId: string }
  }
  if (!(await directory.features()).identities) throw new RoomStoreConflictError('Agent conversations are disabled')
  const selected = defaultEntry ? kun : input.templateId ? [...DEFAULT_AGENT_TEMPLATES, DIAGNOSTICIAN_AGENT_TEMPLATE].find((item) => item.templateId === input.templateId) : undefined
  if (input.templateId && !selected) throw new Error('Agent template not found')
  const now = new Date().toISOString(), id = defaultEntry ? 'agent-default-kun' : 'agent-' + randomUUID()
  const { examples: _examples, ...template } = { examples: [] as string[], ...selected }
  const agent = AgentIdentitySchema.parse({ ...template, id, schemaVersion: 1, name: input.name ?? selected?.name ?? '新 Agent',
    instructions: selected?.instructions ?? kun.instructions.replace('你是小 Kun，', '你是'), createdAt: now, updatedAt: now, revision: 0 })
  const roomId = agentStableId('agent-direct', id)
  const room = RoomSchema.parse({ schemaVersion: 1, id: roomId, name: agent.name, description: agent.title,
    conversationKind: 'user_agent', collaborationMode: 'peer', members: [directory.asMember(agent)], defaultMemberId: id,
    participantAgentIds: [id], repositories: [], revision: 0, createdAt: now, updatedAt: now })
  const result = { agentId: id, roomId }
  const committed = await store.commit({ requestId: key, fingerprint,
    checks: [{ kind: 'agent_identity', id, expectedRevision: null }, { kind: 'room', id: roomId, expectedRevision: null },
      ...(defaultEntry ? [{ kind: 'agent_bootstrap' as const, id: CHAT_ENTRY_ID, expectedRevision: null }] : [])],
    puts: [{ kind: 'agent_identity', id, value: agent }, { kind: 'room', id: roomId, roomId, value: room },
      ...(defaultEntry ? [{ kind: 'agent_bootstrap' as const, id: CHAT_ENTRY_ID, value: { ...result, seen: false } }] : [])],
    events: [{ roomId: 'agent-directory', kind: 'agent.created', payload: { id } }, { roomId, kind: 'room.created', payload: { id: roomId } }], result })
  return committed.result as typeof result
}
