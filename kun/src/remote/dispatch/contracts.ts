import { z } from 'zod'
import { AgentDispatchAssignmentRouteSchema } from '../../contracts/agent-dispatch-intents.js'

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const scope = z.object({ threadId: id }).strict()
export const DispatchParamSchemas = {
  'dispatch.list': scope,
  'dispatch.catalog': scope,
  'dispatch.act': scope.extend({
    intentId: id,
    expectedRevision: z.number().int().positive(),
    action: z.enum(['start_now', 'pause', 'resume', 'cancel', 'update']),
    assignments: z.array(AgentDispatchAssignmentRouteSchema).min(1).max(16).optional()
  }).strict().refine(p => p.action === 'update' ? Boolean(p.assignments) : p.assignments === undefined)
} as const
