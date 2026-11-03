import { z } from 'zod'
export const AgentLifecycleParams = {
  'agent.lifecycle.get': z.object({ agentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict(),
  'agent.restart': z.object({ agentId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expectedLifecycleRevision: z.string().regex(/^agent-life-v1:(0|[1-9]\d*)$/).refine(value => Number.isSafeInteger(Number(value.slice(14)))) }).strict()
} as const
