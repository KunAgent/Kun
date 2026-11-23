import { z } from 'zod'
const threadId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const CodeChangesParamSchemas = {
  'code.changes.list': z.object({ threadId }).strict(),
  'code.changes.get': z.object({ threadId, path: z.string().min(1).max(4096),
    revision: z.string().regex(/^changes-v1:[a-f0-9]{64}$/) }).strict()
} as const
