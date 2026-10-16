import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Thread = { threadId: Id }
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
const Queue = { ...Thread, expectedRevision: z.string().regex(/^queue-v1:[a-f0-9]{64}$/) }
const Input = { text: z.string().min(1).max(64000), attachmentIds: z.array(Id).max(8).default([]) }
export const ExecutionQueueParamSchemas = {
  'execution.queue.list': z.object({ ...Thread, ...Page }).strict(),
  'execution.queue.enqueue': z.object({ ...Thread, ...Input }).strict(),
  'execution.queue.update': z.object({ ...Queue, turnId: Id, ...Input }).strict(),
  'execution.queue.remove': z.object({ ...Queue, turnId: Id }).strict(),
  'execution.resume': z.object(Queue).strict(),
  'execution.steer': z.object({ ...Thread, turnId: Id, ...Input }).strict()
} as const
export const ExecutionStopParamSchemas = {
  'execution.stop': z
    .object({
      threadId: Id.optional(),
      turnId: Id.optional(),
      agentId: Id.optional(),
      executionId: Id.optional()
    })
    .strict()
    .refine((p) =>
      p.agentId
        ? Boolean(p.executionId) && !p.threadId && !p.turnId
        : Boolean(p.threadId && p.turnId) && !p.executionId
    )
} as const
