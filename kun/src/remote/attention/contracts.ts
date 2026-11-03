import { z } from 'zod'
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
export const AttentionParamSchemas = {
  'attention.list': z.object(Page).strict()
} as const
