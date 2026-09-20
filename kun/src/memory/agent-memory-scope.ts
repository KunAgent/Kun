import { z } from 'zod'
import type { MemoryRecord } from '../contracts/memory.js'

const Id = z.string().min(1).max(128)
export const AgentMemoryOwnershipSchema = z.object({
  schemaVersion: z.literal(1), agentId: Id, sourceConversationId: Id,
  sourceRootRequestId: Id.optional(), sourceHandoffId: Id.optional(), sourceTaskId: Id.optional(),
  shared: z.boolean().default(false),
  sharedConversationIds: z.array(Id).max(100).default([]),
  sharedProjectRoots: z.array(z.string().min(1).max(4096)).max(100).default([]),
  locked: z.boolean().default(false), originFingerprint: z.string().max(128).optional(),
  lastOperationId: z.string().max(128).optional()
}).strict()
export const AgentMemoryAccessSchema = z.object({
  agentId: Id, conversationId: Id.optional(), handoffId: Id.optional(), taskId: Id.optional(),
  manage: z.boolean().optional(), operationId: Id.optional(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional()
}).strict()
export type AgentMemoryAccess = z.infer<typeof AgentMemoryAccessSchema>
export type AgentMemoryOwnership = z.infer<typeof AgentMemoryOwnershipSchema>
export type AgentMemoryScope = { agent?: AgentMemoryAccess; workspace?: string; project?: string }

/** Ownership is checked even for list(all), mutations by ID and filesystem fallback. */
export function agentMemoryVisible(record: Pick<MemoryRecord, 'agentContext'>, access: AgentMemoryScope): boolean {
  const owner = record.agentContext, agent = access.agent
  if (!owner) return !agent
  if (!agent || owner.agentId !== agent.agentId) return false
  if (agent.manage || owner.shared) return true
  if (owner.sharedConversationIds.includes(agent.conversationId ?? '') ||
    owner.sharedProjectRoots.includes(access.project ?? access.workspace ?? '')) return true
  if (owner.sourceTaskId) return owner.sourceTaskId === agent.taskId
  return owner.sourceHandoffId ? owner.sourceHandoffId === agent.handoffId
    : owner.sourceConversationId === agent.conversationId
}

/** Apply before FTS ranking, candidate LIMIT and document materialization. */
export function agentMemoryScopeSql(where: string[], params: Record<string, unknown>,
  access: AgentMemoryScope, prefix = ''): void {
  const field = (key: string) => "json_extract(" + prefix + "record_json,'$.agentContext." + key + "')"
  if (!access.agent) { where.push(field('agentId') + ' IS NULL'); return }
  params.agentOwnerId = access.agent.agentId
  where.push(field('agentId') + '=@agentOwnerId')
  if (access.agent.manage) return
  params.agentConversationId = access.agent.conversationId ?? ''
  params.agentHandoffId = access.agent.handoffId ?? ''
  params.agentTaskId = access.agent.taskId ?? ''
  params.agentProjectRoot = access.project ?? access.workspace ?? ''
  where.push('(' + field('shared') + '=1 OR ' +
    '(EXISTS(SELECT 1 FROM json_each(' + prefix + "record_json,'$.agentContext.sharedConversationIds') a WHERE a.value=@agentConversationId)) OR " +
    '(EXISTS(SELECT 1 FROM json_each(' + prefix + "record_json,'$.agentContext.sharedProjectRoots') a WHERE a.value=@agentProjectRoot)) OR " +
    '(' + field('sourceTaskId') + ' IS NOT NULL AND ' + field('sourceTaskId') + '=@agentTaskId) OR ' +
    '(' + field('sourceTaskId') + ' IS NULL AND ' + field('sourceHandoffId') + ' IS NOT NULL AND ' + field('sourceHandoffId') + '=@agentHandoffId) OR ' +
    '(' + field('sourceTaskId') + ' IS NULL AND ' + field('sourceHandoffId') + ' IS NULL AND ' + field('sourceConversationId') + '=@agentConversationId))')
}
