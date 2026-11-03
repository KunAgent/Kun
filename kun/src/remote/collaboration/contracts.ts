import { z } from 'zod'
export const CollaborationListParams = z.object({ roomId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  cursor: z.string().regex(/^[0-9]{1,16}$/).optional(), limit: z.number().int().min(1).max(20).default(20) }).strict()
export const CollaborationParamSchemas = { 'collaboration.runs.list': CollaborationListParams, 'collaboration.tasks.list': CollaborationListParams } as const
