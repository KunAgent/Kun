import { z } from 'zod'

/**
 * Lightweight HTTP mirror of Kun's agent roster (`GET /v1/agent-roster`),
 * independent of its runtime types. Unknown fields are tolerated so an older
 * GUI keeps reading a newer runtime.
 */
export type AgentRosterLaneName = 'delegate' | 'worker' | 'graph' | 'conversation'

const laneStatus = z.union([
  z.object({ state: z.literal('ok') }),
  z.object({ state: z.literal('unchecked') }),
  z.object({ state: z.literal('blocked'), code: z.string(), message: z.string() })
])

const engine = z.union([
  z.object({ kind: z.literal('lane-default') }),
  z.object({
    kind: z.literal('bound'),
    harnessId: z.string().min(1),
    displayName: z.string().min(1),
    credentialMode: z.enum(['native-login', 'provider', 'kun-gateway']),
    model: z.string().optional(),
    providerId: z.string().optional()
  })
])

export const AgentRosterEntryViewSchema = z.object({
  id: z.string().min(1),
  source: z.enum(['builtin', 'configured', 'workspace', 'learned']),
  name: z.string().min(1),
  description: z.string(),
  owns: z.string().optional(),
  mode: z.enum(['subagent', 'primary', 'all']),
  toolPolicy: z.enum(['readOnly', 'inherit']),
  engine,
  facts: z.object({
    writes: z.boolean(),
    resumable: z.boolean(),
    liveProgress: z.boolean(),
    kunTools: z.boolean(),
    userInput: z.boolean()
  }),
  lanes: z.object({
    delegate: laneStatus,
    worker: laneStatus,
    graph: laneStatus,
    conversation: laneStatus
  })
})
export type AgentRosterEntryView = z.infer<typeof AgentRosterEntryViewSchema>
export type AgentRosterLaneStatusView = AgentRosterEntryView['lanes']['delegate']

export function agentRosterPath(input: { workspace?: string; surface?: 'code' | 'write' | 'design' } = {}): string {
  const params = new URLSearchParams()
  if (input.surface) params.set('surface', input.surface)
  if (input.workspace) params.set('workspace', input.workspace)
  const query = params.toString()
  return query ? `/v1/agent-roster?${query}` : '/v1/agent-roster'
}

/** Roles a dispatch card may assign: workers take dispatchable roles, task sessions take session roles. */
export function rosterRolesFor(
  entries: readonly AgentRosterEntryView[],
  use: 'worker' | 'session'
): AgentRosterEntryView[] {
  return entries.filter((entry) => use === 'worker' ? entry.mode !== 'primary' : entry.mode !== 'subagent')
}
