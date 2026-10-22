import { z } from 'zod'
import { SubagentMode, SubagentSurface, SubagentToolPolicy } from './capabilities.js'
import { HarnessGatewayBindingSchema } from './harness-gateway-binding.js'
import { HarnessCredentialModeSchema, HarnessIdSchema } from './harness.js'

/**
 * The agent roster: every reusable role Kun can dispatch to, with the engine it
 * is bound to and what each dispatch lane can actually run. Entries are derived
 * from subagent profiles (built-in, configured, workspace `.kun/agents/*.md`)
 * and learned Graph profiles; nothing here is a second configuration source.
 */

export const AgentRosterSourceSchema = z.enum(['builtin', 'configured', 'workspace', 'learned'])
export type AgentRosterSource = z.infer<typeof AgentRosterSourceSchema>

/** A dispatch granularity. Each lane maps onto one harness admission usage. */
export const AGENT_ROSTER_LANES = ['delegate', 'worker', 'graph', 'conversation'] as const
export const AgentRosterLaneSchema = z.enum(AGENT_ROSTER_LANES)
export type AgentRosterLane = z.infer<typeof AgentRosterLaneSchema>

export const AgentRosterEngineSchema = z.discriminatedUnion('kind', [
  /** No engine binding: the lane's own default picks the engine. */
  z.object({ kind: z.literal('lane-default') }).strict(),
  z.object({
    kind: z.literal('bound'),
    harnessId: HarnessIdSchema,
    displayName: z.string().min(1).max(128),
    credentialMode: HarnessCredentialModeSchema,
    model: z.string().min(1).max(512).optional(),
    providerId: z.string().min(1).max(128).optional(),
    gatewayBinding: HarnessGatewayBindingSchema.optional()
  }).strict()
])
export type AgentRosterEngine = z.infer<typeof AgentRosterEngineSchema>

/** Derived from the role and the engine's capability matrix; never configured. */
export const AgentRosterFactsSchema = z.object({
  writes: z.boolean(),
  resumable: z.boolean(),
  liveProgress: z.boolean(),
  kunTools: z.boolean(),
  userInput: z.boolean()
}).strict()
export type AgentRosterFacts = z.infer<typeof AgentRosterFactsSchema>

export const AgentRosterFailureCodeSchema = z.enum([
  'not_found',
  'surface_mismatch',
  'mode_mismatch',
  'engine_unavailable',
  'engine_not_ready',
  'capability_missing',
  'sandbox_insufficient'
])
export type AgentRosterFailureCode = z.infer<typeof AgentRosterFailureCodeSchema>

export const AgentRosterLaneStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok') }).strict(),
  /** The engine's readiness has not been probed yet; dispatch checks it. */
  z.object({ state: z.literal('unchecked') }).strict(),
  z.object({
    state: z.literal('blocked'),
    code: AgentRosterFailureCodeSchema,
    message: z.string().max(512)
  }).strict()
])
export type AgentRosterLaneStatus = z.infer<typeof AgentRosterLaneStatusSchema>

export const AgentRosterEntrySchema = z.object({
  id: z.string().min(1).max(128),
  source: AgentRosterSourceSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(2_048),
  owns: z.string().max(300).optional(),
  surfaces: z.array(SubagentSurface),
  mode: SubagentMode,
  toolPolicy: SubagentToolPolicy,
  engine: AgentRosterEngineSchema,
  facts: AgentRosterFactsSchema,
  lanes: z.object({
    delegate: AgentRosterLaneStatusSchema,
    worker: AgentRosterLaneStatusSchema,
    graph: AgentRosterLaneStatusSchema,
    conversation: AgentRosterLaneStatusSchema
  }).strict()
}).strict()
export type AgentRosterEntry = z.infer<typeof AgentRosterEntrySchema>

export const AgentRosterListResponseSchema = z.object({
  surface: z.enum(['code', 'write', 'design']),
  entries: z.array(AgentRosterEntrySchema)
}).strict()
export type AgentRosterListResponse = z.infer<typeof AgentRosterListResponseSchema>

/** Lane -> harness admission usage (`harness/usage-for-turn.ts`). */
export const AGENT_ROSTER_LANE_USAGE = {
  delegate: 'delegate-child',
  worker: 'manager-worker',
  graph: 'graph-worker',
  conversation: 'room-conversation'
} as const satisfies Record<AgentRosterLane, string>
