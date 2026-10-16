import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
export const AgentSearchParamSchemas = {
  'agent.search': z.object({ ...Page, query: z.string().min(1).max(200).refine((value) => Boolean(value.trim())),
    includeArchived: z.boolean().default(false) }).strict()
} as const
