import { z } from 'zod'
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Agent = { agentId: Id }
const Page = { cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
const Run = { ...Agent, runId: Id, expectedRevision: Revision }
export const AgentLibraryParamSchemas = {
  'agent.runs.list': z.object({ ...Agent, ...Page, status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'recovery_required']).optional() }).strict(),
  'agent.runs.get': z.union([
    z.object(Run).strict(),
    z.object({ ...Run, messageId: Id, expectedMessageRevision: Revision, contentOffset: Revision.default(0),
      maxChars: z.number().int().min(1).max(16000).default(16000) }).strict()
  ]),
  'agent.artifacts.list': z.object({ ...Agent, ...Page, archived: z.boolean().default(false), search: z.string().trim().max(200).optional() }).strict(),
  'agent.artifacts.get': z.object({ ...Agent, artifactId: Id, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  'agent.artifacts.versions': z.object({ ...Agent, artifactId: Id, ...Page }).strict()
} as const
export const AGENT_LIBRARY_READ_METHODS = new Set(Object.keys(AgentLibraryParamSchemas))
