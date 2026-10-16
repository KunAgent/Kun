import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const RequestParamSchemas = {
  'request.get': z.object({ requestId: Id }).strict()
} as const
