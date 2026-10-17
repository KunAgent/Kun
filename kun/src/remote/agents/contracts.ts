import { AgentAppearanceParams, AGENT_APPEARANCE_READ_METHODS } from './appearance-contracts.js'
import { AgentLifecycleParams } from './lifecycle-contracts.js'
import { AgentImportParams } from './import-contracts.js'
import { z } from 'zod'
import { AgentHistoryParamSchemas, AGENT_HISTORY_READ_METHODS } from './memory/history-contracts.js'
import { AgentLibraryParamSchemas, AGENT_LIBRARY_READ_METHODS } from './library/contracts.js'
import { ReminderParamSchemas, REMINDER_READ_METHODS } from './reminders-contracts.js'
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Page = { cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(50).default(20) }
const Agent = { agentId: Id }
const Fingerprint = z.string().regex(/^[a-f0-9]{64}$/)
const Time = z.string().datetime({ offset: true }).nullable()
const Model = z.object({ providerId: z.string().min(1).max(128), model: z.string().min(1).max(256) }).strict()
const Profile = {
  name: z.string().trim().min(1).max(80).optional(), title: z.string().max(160).optional(),
  instructions: z.string().max(8000).optional(), modelRef: Model.nullable().optional(), fastModelRef: Model.nullable().optional()
}
const MemoryBase = { ...Agent, memoryId: Id, expectedFingerprint: Fingerprint }
const MemoryContent = z.string().trim().min(1).max(4000)
const Status = z.enum(['open', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled'])
const WorkFields = {
  objective: z.string().trim().min(1).max(8000).optional(), acceptance: z.string().trim().min(1).max(4000).optional(),
  deadline: Time.optional(), nextCheckAt: Time.optional(), waitingOn: z.string().max(2000).nullable().optional()
}
export const AgentParamSchemas = {
  ...AgentLifecycleParams,
  ...AgentImportParams,
  ...AgentAppearanceParams,
  ...AgentHistoryParamSchemas,
  ...AgentLibraryParamSchemas,
  ...ReminderParamSchemas,
  'agent.get': z.object(Agent).strict(),
  'agent.create': z.object({ ...Profile, name: Profile.name.unwrap() }).strict(),
  'agent.update': z.object({ ...Agent, expectedRevision: Revision, ...Profile }).strict()
    .refine((p) => Object.keys(Profile).some((key) => Object.hasOwn(p, key)), 'profile fields required'),
  'agent.archive': z.object({ ...Agent, expectedRevision: Revision }).strict(),
  'agent.restore': z.object({ ...Agent, expectedRevision: Revision }).strict(),
  'agent.memory.list': z.object({ ...Agent, ...Page, includeDeleted: z.boolean().default(false) }).strict(),
  'agent.memory.update': z.discriminatedUnion('action', [
    z.object({ ...Agent, action: z.literal('create'), roomId: Id, sourceMessageIds: z.array(Id).min(1).max(8),
      content: MemoryContent, type: z.enum(['fact', 'preference', 'decision', 'episode', 'relationship', 'insight']).default('fact') }).strict(),
    z.object({ ...MemoryBase, action: z.literal('edit'), content: MemoryContent.optional(), disabled: z.boolean().optional() }).strict()
      .refine((p) => p.content !== undefined || p.disabled !== undefined, 'memory changes required'),
    z.object({ ...MemoryBase, action: z.literal('forget') }).strict()
  ]),
  'agent.commitments.list': z.object({ ...Agent, ...Page, status: Status.optional(), search: z.string().trim().max(200).optional() }).strict(),
  'agent.commitments.act': z.discriminatedUnion('action', [
    z.object({ ...Agent, action: z.literal('create'), roomId: Id, sourceMessageId: Id, ...WorkFields,
      objective: WorkFields.objective.unwrap(), acceptance: WorkFields.acceptance.unwrap() }).strict(),
    z.object({ ...Agent, action: z.literal('update'), commitmentId: Id, expectedRevision: Revision, ...WorkFields,
      status: Status.optional(), acceptanceEvidence: z.array(z.object({ summary: z.string().trim().min(1).max(4000),
        reference: z.string().min(1).max(4096).optional() }).strict()).max(30).optional() }).strict()
      .refine((p) => [...Object.keys(WorkFields), 'status', 'acceptanceEvidence'].some((key) => Object.hasOwn(p, key)), 'commitment changes required'),
    z.object({ ...Agent, action: z.literal('cancel'), commitmentId: Id, expectedRevision: Revision }).strict()
  ])
} as const
export const AGENT_READ_METHODS = new Set(['agent.lifecycle.get', 'agent.get', 'agent.memory.list', 'agent.commitments.list', ...AGENT_APPEARANCE_READ_METHODS, ...AGENT_HISTORY_READ_METHODS, ...AGENT_LIBRARY_READ_METHODS, ...REMINDER_READ_METHODS])
export type AgentMethod = keyof typeof AgentParamSchemas
