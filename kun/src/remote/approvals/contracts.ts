import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
export const ApprovalParamSchemas = {
  'approval.list': z
    .object({ threadId: Id.optional(), agentId: Id.optional() })
    .strict(),
  'approval.prepare': z.object({ approvalId: Id }).strict(),
  'approval.resolve': z
    .object({
      approvalId: Id,
      challenge: z.string().max(256),
      decision: z.enum(['allow', 'deny']),
      choice: z.unknown().optional()
    })
    .strict(),
  'input.resolve': z
    .object({ inputId: Id, answers: z.array(z.unknown()).max(20) })
    .strict()
} as const
