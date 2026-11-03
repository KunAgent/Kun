import { z } from 'zod'
import { ROOM_BUILTIN_AVATAR_IDS } from '../../contracts/kun-avatar-presets.js'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Page = { agentId: Id, cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
export const AgentAppearanceParams = {
  'agent.avatar.get': z.object({ agentId: Id }).strict(),
  'agent.avatar.update': z.object({ agentId: Id, expectedRevision: Revision, source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('builtin'), id: z.enum(ROOM_BUILTIN_AVATAR_IDS) }).strict(),
    z.object({ kind: z.literal('received'), attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/) }).strict(),
    z.object({ kind: z.literal('clear') }).strict()
  ]) }).strict(),
  'agent.skills.list': z.object(Page).strict(),
  'agent.connections.list': z.object(Page).strict()
} as const
export const AGENT_APPEARANCE_READ_METHODS = new Set(['agent.avatar.get', 'agent.skills.list', 'agent.connections.list'])
export const AvatarExportParams = z.object({ agentId: Id, avatarRevision: Revision }).strict()
