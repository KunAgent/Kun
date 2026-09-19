import { AgentIdentitySchema, type AgentIdentity } from '../contracts/agent-identities.js'
import { OnboardingRequest, type OnboardingState } from '../contracts/room-onboarding.js'
import { RoomSchema, type Room } from '../contracts/rooms.js'
import { roomFingerprint } from '../rooms/room-service.js'
import { RoomStoreConflictError, type RoomStoreCommit } from '../rooms/room-store.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'
import { DEFAULT_AGENT_TEMPLATES } from './agent-defaults.js'

type Saved = Pick<OnboardingState, 'completed' | 'dismissed' | 'seen' | 'bindings' | 'groupId' | 'coordinatorRoomId'>
const KEY = 'starter-team-v2'
export async function agentOnboardingState(directory: AgentIdentityService): Promise<OnboardingState> {
  await directory.initialize()
  const row = await directory.store.get<Saved>('agent_bootstrap', KEY)
  const migration = await directory.store.get<{ fresh?: boolean }>('agent_bootstrap', 'identities-v1')
  const slots = await Promise.all(DEFAULT_AGENT_TEMPLATES.map(async (template) => {
    const id = row?.value.bindings?.[template.templateId] ?? 'agent-default-' + template.templateId
    const agent = await directory.store.get<AgentIdentity>('agent_identity', id)
    return { templateId: template.templateId, name: template.name, title: template.title ?? '',
      ...(agent && !agent.value.archivedAt ? { agent: AgentIdentitySchema.parse({ ...agent.value, revision: agent.revision }) } : {}) }
  }))
  const existing = await directory.store.list('agent_identity', { limit: 1, includeArchived: true })
  const rooms = await directory.store.list('room', { limit: 1, includeArchived: true })
  return { completed: false, dismissed: false, seen: false, ...row?.value, revision: row?.revision ?? null,
    fresh: !row && migration?.value.fresh === true && !existing.length && !rooms.length, slots }
}

export async function updateAgentOnboarding(directory: AgentIdentityService, raw: unknown): Promise<OnboardingState> {
  const input = OnboardingRequest.parse(raw), store = directory.store
  const requestId = 'agent-onboarding:' + input.clientRequestId, fingerprint = roomFingerprint(input)
  const receipt = await store.getRequest(requestId)
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw new RoomStoreConflictError('onboarding request changed')
    return agentOnboardingState(directory)
  }
  const state = await agentOnboardingState(directory)
  if (input.action === 'initialize' && !state.fresh && !state.completed) throw new RoomStoreConflictError('review the existing team before completing setup')
  if ((input.action === 'initialize' || input.action === 'complete') && state.completed) return state
  if (state.revision !== input.expectedRevision) throw new RoomStoreConflictError('team setup changed', state.revision)
  const checks: NonNullable<RoomStoreCommit['checks']> = [{ kind: 'agent_bootstrap', id: KEY, expectedRevision: state.revision }]
  const puts: NonNullable<RoomStoreCommit['puts']> = []
  const events: NonNullable<RoomStoreCommit['events']> = []
  const value: Saved = { completed: state.completed, dismissed: state.dismissed, seen: state.seen,
    bindings: state.bindings, groupId: state.groupId, coordinatorRoomId: state.coordinatorRoomId }
  if (input.action === 'dismiss') value.dismissed = true
  else if (input.action === 'seen') value.seen = true
  else {
    if (!(await directory.features()).identities) throw new RoomStoreConflictError('agent creation is disabled')
    if (input.action === 'complete' && !input.selections) throw new RoomStoreConflictError('choose the five team members')
    const now = new Date().toISOString(), agents: AgentIdentity[] = [], newIds = new Set<string>()
    const selections = new Map(input.selections?.map((item) => [item.templateId, item]))
    if (input.selections && (selections.size !== 5 || DEFAULT_AGENT_TEMPLATES.some((template) => !selections.has(template.templateId)))) {
      throw new RoomStoreConflictError('choose each team role once')
    }
    for (const template of DEFAULT_AGENT_TEMPLATES) {
      const selection = selections.get(template.templateId)
      if (selection?.agentId) {
        const agent = await directory.active(selection.agentId)
        if (agent.revision !== selection.revision) throw new RoomStoreConflictError('selected agent changed', agent.revision)
        checks.push({ kind: 'agent_identity', id: agent.id, expectedRevision: agent.revision })
        agents.push(agent)
      } else {
        const preferred = 'agent-default-' + template.templateId
        const id = await store.get('agent_identity', preferred) ? agentStableId('agent-starter', input.clientRequestId, template.templateId) : preferred
        const { examples: _examples, ...fields } = template
        const agent = AgentIdentitySchema.parse({ ...fields, id, schemaVersion: 1, revision: 0, createdAt: now, updatedAt: now })
        checks.push({ kind: 'agent_identity', id, expectedRevision: null }); newIds.add(id); agents.push(agent)
      }
    }
    if (new Set(agents.map((agent) => agent.id)).size !== 5) throw new RoomStoreConflictError('choose five distinct agents')
    const bindings = Object.fromEntries(DEFAULT_AGENT_TEMPLATES.map((template, index) => [template.templateId, agents[index].id]))
    for (const agent of agents) {
      if (newIds.has(agent.id)) {
        if (agent.templateId === 'developer') agent.reviewerAgentId = bindings.reviewer
        puts.push({ kind: 'agent_identity', id: agent.id, value: agent })
        events.push({ roomId: 'agent-directory', kind: 'agent.created', payload: { id: agent.id } })
      }
      const id = agentStableId('agent-direct', agent.id)
      const existing = await store.get<Room>('room', id)
      if (existing) {
        if (existing.value.archivedAt) throw new RoomStoreConflictError('restore the selected private conversation or choose another agent')
        checks.push({ kind: 'room', id, expectedRevision: existing.revision })
      } else {
        const room = RoomSchema.parse({ id, schemaVersion: 1, name: agent.name, description: agent.title,
          conversationKind: 'user_agent', collaborationMode: 'peer', members: [directory.asMember(agent)],
          participantAgentIds: [agent.id], defaultMemberId: agent.id, repositories: [], revision: 0, createdAt: now, updatedAt: now })
        checks.push({ kind: 'room', id, expectedRevision: null }); puts.push({ kind: 'room', id, roomId: id, value: room })
        events.push({ roomId: id, kind: 'room.created', payload: { id } })
      }
    }
    const groupId = agentStableId('starter-group', KEY)
    const room = RoomSchema.parse({ id: groupId, schemaVersion: 1, name: '我的团队', description: '一起澄清目标、研究、设计、实现与评审。',
      conversationKind: 'group', collaborationMode: 'peer', members: agents.map((agent) => directory.asMember(agent)),
      participantAgentIds: agents.map((agent) => agent.id), defaultMemberId: bindings.coordinator,
      repositories: [], revision: 0, createdAt: now, updatedAt: now })
    checks.push({ kind: 'room', id: groupId, expectedRevision: null }); puts.push({ kind: 'room', id: groupId, roomId: groupId, value: room })
    events.push({ roomId: groupId, kind: 'room.created', payload: { id: groupId } })
    Object.assign(value, { completed: true, dismissed: false, bindings, groupId, coordinatorRoomId: agentStableId('agent-direct', bindings.coordinator) })
  }
  puts.push({ kind: 'agent_bootstrap', id: KEY, value })
  events.push({ roomId: 'agent-directory', kind: 'agent.onboarding.updated', payload: {} })
  await store.commit({ requestId, fingerprint, checks, puts, events })
  return agentOnboardingState(directory)
}
