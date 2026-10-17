import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Page = { cursor: z.string().max(2048).optional() }
const Message = { text: z.string().max(64000), attachmentIds: z.array(Id).max(8).default([]) }
export const AgentConversationParamSchemas = {
  'agent.list': z.object(Page).strict(),
  'agent.history': z.object({ agentId: Id, ...Page }).strict(),
  'agent.message.send': z.object({ agentId: Id, ...Message }).strict()
} as const
