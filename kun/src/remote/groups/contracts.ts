import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Revision = z.number().int().nonnegative()
const Name = z.string().trim().min(1).max(120).refine((v) => !v.includes('\0'))
const Description = z.string().max(8000).refine((v) => !v.includes('\0'))
const Mode = z.enum(['peer', 'directed', 'autonomous'])
const mutable = { name: Name.optional(), description: Description.optional(), defaultMemberId: Id.optional(),
  collaborationMode: Mode.optional(), maxConcurrentTasks: z.number().int().min(1).max(2).optional(), pinned: z.boolean().optional() }
const target = { roomId: Id, expectedRevision: Revision }
export const GroupGetParams = z.object({ roomId: Id }).strict()
export const GroupCreateParams = z.object({ name: Name, description: Description.optional(),
  participantAgentIds: z.array(Id).min(1).max(20).refine((ids) => new Set(ids).size === ids.length),
  defaultAgentId: Id.optional(), collaborationMode: Mode.optional(), maxConcurrentTasks: z.number().int().min(1).max(2).optional()
}).strict().refine((p) => !p.defaultAgentId || p.participantAgentIds.includes(p.defaultAgentId))
export const GroupUpdateParams = z.object({ ...target, ...mutable }).strict()
  .refine((p) => Object.keys(mutable).some((key) => p[key as keyof typeof p] !== undefined), 'empty group update')
export const GroupArchiveParams = z.object(target).strict()
export const GroupMemberAddParams = z.object({ ...target, agentId: Id }).strict()
export const GroupMemberUpdateParams = z.object({ ...target, memberId: Id, enabled: z.boolean(), defaultMemberId: Id.optional() }).strict()
export const GroupMemberRemoveParams = z.object({ ...target, memberId: Id, defaultMemberId: Id.optional() }).strict()
export const GroupWriteParamSchemas = {
  'group.create': GroupCreateParams, 'group.update': GroupUpdateParams,
  'group.archive': GroupArchiveParams, 'group.restore': GroupArchiveParams,
  'group.member.add': GroupMemberAddParams, 'group.member.update': GroupMemberUpdateParams, 'group.member.remove': GroupMemberRemoveParams
}
export type GroupWriteMethod = keyof typeof GroupWriteParamSchemas
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
export const GroupListParams = z.object({ ...Page, query: z.string().max(200).optional(), archived: z.boolean().default(false) }).strict()
export const GroupHistoryParams = z.object({ ...Page, roomId: Id }).strict()
export const GroupSendParams = z.object({ roomId: Id, text: z.string().min(1).max(64000),
  mentionMemberIds: z.array(Id).max(20).default([]), executionIntent: z.enum(['auto', 'discussion', 'execute']).default('auto') }).strict()
export const GroupParamSchemas = { ...GroupWriteParamSchemas, 'group.get': GroupGetParams, 'group.list': GroupListParams, 'group.history': GroupHistoryParams, 'group.message.send': GroupSendParams } as const
