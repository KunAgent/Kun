import { z } from 'zod'
import { UpdatedTime, validUpdatedRange } from './search-filters.js'
import { TurnReasoningEffortSchema } from '../../contracts/turn-reasoning.js'
import { TurnServiceTierSchema } from '../../contracts/turns.js'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
const Thread = { threadId: Id }
const Revision = z.string().regex(/^thread-v1:(0|[1-9][0-9]{0,15})$/)
const Mutation = { ...Thread, expectedRevision: Revision }
/** Echo of a catalog route's opaque `routeKey` (remote protocol 0.17); resolved server side. */
const RouteKey = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
export const RouteSchema = z.object({
  model: z.string().min(1).max(512), harnessId: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).optional(),
  credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
  providerId: z.string().min(1).max(128).optional(),
  routeKey: RouteKey.optional(),
  // Checked against the chosen model's catalog profile server side.
  reasoningEffort: TurnReasoningEffortSchema.optional()
}).strict()
export const CodeManagementParamSchemas = {
  'code.search': z.object({ ...Page, query: z.string().trim().max(200).default(''),
    status: z.enum(['all', 'running', 'idle', 'archived']).default('all'), projectId: Id.optional(),
    harnessId: z.string().max(48).optional(), updatedFrom: UpdatedTime.optional(), updatedBefore: UpdatedTime.optional() }).strict()
    .refine(validUpdatedRange, 'invalid updated time range'),
  'code.rename': z.object({ ...Mutation, title: z.string().trim().min(1).max(160) }).strict(),
  'code.pin': z.object({ ...Mutation, pinned: z.boolean() }).strict(),
  'code.archive': z.object(Mutation).strict(),
  'code.restore': z.object(Mutation).strict(),
  'code.delete': z.object(Mutation).strict(),
  'code.settings.get': z.object(Thread).strict(),
  'code.settings.update': z.object({ ...Thread,
    expectedRevision: z.string().regex(/^task-config-v1:[a-f0-9]{64}$/), next: RouteSchema }).strict()
} as const
const Cursor = { cursor: z.string().max(2048).optional() }
const Message = { text: z.string().max(64000), attachmentIds: z.array(Id).max(8).default([]) }
export const CodeTaskParamSchemas = {
  'code.list': z.object(Cursor).strict(),
  'code.history': z.object({ ...Thread, ...Cursor }).strict(),
  'code.create': z
    .object({
      projectId: Id,
      title: z.string().max(160).default('Mobile task'),
      model: z.string().max(256).optional(),
      // An Agent pick from `catalog.get` agents; re-validated server side.
      harnessId: z.string().regex(/^[a-z][a-z0-9-]{1,47}$/).optional(),
      credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']).optional(),
      providerId: z.string().min(1).max(128).optional(),
      routeKey: RouteKey.optional(),
      reasoningEffort: TurnReasoningEffortSchema.optional()
    })
    .strict(),
  // Fast mode (remote protocol 0.18, `code.modelInfo`): a sender preference the route it runs on may not take.
  'code.turn.start': z.object({ ...Thread, ...Message, serviceTier: TurnServiceTierSchema.optional() }).strict()
} as const
