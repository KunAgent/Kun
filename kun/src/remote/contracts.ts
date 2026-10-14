import { z } from 'zod'
export const RemoteId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Page = { cursor: z.string().max(2048).optional() }
const Thread = { threadId: RemoteId }
const Message = {
  text: z.string().max(64000),
  attachmentIds: z.array(RemoteId).max(8).default([])
}
export const ParamSchemas = {
  'catalog.get': z.object({}).strict(),
  'agent.list': z.object(Page).strict(),
  'agent.history': z.object({ agentId: RemoteId, ...Page }).strict(),
  'agent.message.send': z.object({ agentId: RemoteId, ...Message }).strict(),
  'code.list': z.object(Page).strict(),
  'code.history': z.object({ ...Thread, ...Page }).strict(),
  'code.create': z
    .object({
      projectId: RemoteId,
      title: z.string().max(160).default('Mobile task'),
      model: z.string().max(256).optional(),
      // An Agent pick from `catalog.get` agents; re-validated server side.
      harnessId: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).optional(),
      credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
      providerId: z.string().min(1).max(128).optional()
    })
    .strict(),
  'code.turn.start': z.object({ ...Thread, ...Message }).strict(),
  'execution.stop': z
    .object({
      threadId: RemoteId.optional(),
      turnId: RemoteId.optional(),
      agentId: RemoteId.optional(),
      executionId: RemoteId.optional()
    })
    .strict()
    .refine((p) =>
      p.agentId
        ? Boolean(p.executionId) && !p.threadId && !p.turnId
        : Boolean(p.threadId && p.turnId) && !p.executionId
    ),
  'request.get': z.object({ requestId: RemoteId }).strict(),
  'approval.list': z
    .object({ threadId: RemoteId.optional(), agentId: RemoteId.optional() })
    .strict(),
  'approval.prepare': z.object({ approvalId: RemoteId }).strict(),
  'approval.resolve': z
    .object({
      approvalId: RemoteId,
      challenge: z.string().max(256),
      decision: z.enum(['allow', 'deny']),
      choice: z.unknown().optional()
    })
    .strict(),
  'input.resolve': z
    .object({ inputId: RemoteId, answers: z.array(z.unknown()).max(20) })
    .strict()
} as const
export type Method = keyof typeof ParamSchemas
export const Envelope = z
  .object({
    accountId: RemoteId,
    deviceId: RemoteId,
    authorizationId: RemoteId,
    call: z
      .object({
        method: z.enum(Object.keys(ParamSchemas) as [Method, ...Method[]]),
        requestId: RemoteId,
        expiresAt: z.number().int().positive(),
        params: z.record(z.string(), z.unknown())
      })
      .strict()
  })
  .strict()
export type Envelope = z.infer<typeof Envelope>
export type RemoteScope = Pick<
  Envelope,
  'accountId' | 'deviceId' | 'authorizationId'
>
