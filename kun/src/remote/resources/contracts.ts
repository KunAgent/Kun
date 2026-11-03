import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const ResourceSchema = z.object({ kind: z.enum(['code', 'agent']), id: Id }).strict()
export type RemoteResource = z.infer<typeof ResourceSchema>
