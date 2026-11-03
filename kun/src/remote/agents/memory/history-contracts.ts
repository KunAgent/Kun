import { z } from 'zod'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const Agent = { agentId: Id }
const Candidate = { ...Agent, candidateId: Id, expectedRevision: Revision }
const Memory = { ...Agent, memoryId: Id, expectedFingerprint: Fingerprint }
const Page = { cursor: z.string().min(1).max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }
const Slice = { contentOffset: Revision.default(0), maxChars: z.number().int().min(1).max(16000).default(16000) }
export const AgentHistoryParamSchemas = {
  'agent.memory.candidates.list': z.object({ ...Agent, ...Page }).strict(),
  'agent.memory.candidates.get': z.discriminatedUnion('side', [
    z.object({ ...Candidate, side: z.literal('proposed'), ...Slice }).strict(),
    z.object({ ...Candidate, side: z.literal('current'), expectedTargetFingerprint: Fingerprint, ...Slice }).strict()
  ]),
  'agent.memory.candidates.decide': z.discriminatedUnion('decision', [
    z.object({ ...Candidate, decision: z.literal('accept'), expectedTargetFingerprint: Fingerprint.optional() }).strict(),
    z.object({ ...Candidate, decision: z.literal('reject') }).strict()
  ]),
  'agent.memory.history.list': z.object({ ...Memory, ...Page }).strict(),
  'agent.memory.history.get': z.object({ ...Memory, revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), ...Slice }).strict()
} as const
export const AGENT_HISTORY_READ_METHODS = new Set(Object.keys(AgentHistoryParamSchemas).filter((method) => !method.endsWith('.decide')))
