import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const ReminderParamSchemas = {
  'agent.reminders.list': z.object({ agentId: Id,
    status: z.enum(['active', 'all', 'scheduled', 'paused', 'fired', 'cancelled', 'expired']).default('active'),
    cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }).strict(),
  'agent.reminders.act': z.object({ agentId: Id, reminderId: Id,
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), action: z.enum(['pause', 'resume', 'cancel']) }).strict()
} as const
export const REMINDER_READ_METHODS = new Set(['agent.reminders.list'])
