import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const WorkParamSchemas = {
  'work.spaces.list': z.object({}).strict(),
  'work.sessions.list': z.object({ spaceId: Id, query: z.string().trim().max(200).default(''),
    status: z.enum(['all', 'archived']).default('all'), cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(50).default(20) }).strict()
} as const
