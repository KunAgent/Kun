import { z } from 'zod'

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)

export const TodoParamSchemas = {
  'todo.thread.get': z.object({ threadId: Id }).strict()
} as const
