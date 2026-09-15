import { observeRoomRepository } from '../rooms/task-workspace-service.js'
import { createHash, randomUUID } from 'node:crypto'
import { AgentIdentitySchema, CreateAgentRequest, UpdateAgentRequest, AgentPageQuery,
  AgentFeaturesSchema, type AgentIdentity, type AgentPage, type AgentFeatures } from '../contracts/agent-identities.js'
import { RoomMemberSchema, RoomSchema, type Room, type RoomMember } from '../contracts/rooms.js'
import type { SubagentProfileConfig } from '../contracts/capabilities-core.js'
import type { RoomStore, RoomStoreCommit } from '../rooms/room-store.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { DEFAULT_AGENT_TEMPLATES } from './agent-defaults.js'
import { bindAgentMembers, freezeAgentRoom } from './agent-membership.js'

export const agentStableId = (kind: string, ...parts: string[]): string =>
  kind + '-' + createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 40)
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const namespace = 'agent-directory'

export class AgentIdentityService {
  private initializing?: Promise<void>
  constructor(readonly store: RoomStore, readonly profiles: () => Record<string, SubagentProfileConfig>,
    private readonly validateAvatars?: (members: RoomMember[]) => Promise<void>) {}

  async features(): Promise<AgentFeatures> {
    return AgentFeaturesSchema.parse((await this.store.get('agent_features', 'features'))?.value ?? {})
  }
  async updateFeatures(input: { clientRequestId: string; expectedRevision: number | null; features: AgentFeatures }) {
    const value = AgentFeaturesSchema.parse(input.features)
    const result = await this.store.commit({ requestId: 'agent-features:' + input.clientRequestId,
      fingerprint: fingerprint(input), checks: [{ kind: 'agent_features', id: 'features', expectedRevision: input.expectedRevision }],
      puts: [{ kind: 'agent_features', id: 'features', value }], result: { features: value, revision: (input.expectedRevision ?? -1) + 1 },
      events: [{ roomId: namespace, kind: 'agent.features.updated', payload: {} }] })
    return result.result
  }
  async initialize(): Promise<void> {
    if (!this.initializing) this.initializing = this.migrate().catch((error) => { this.initializing = undefined; throw error })
    return this.initializing
  }
  private async migrate(): Promise<void> {
    if (await this.store.get('agent_bootstrap', 'identities-v1')) return
    let afterSeq = 0, found = false
    for (;;) {
      const rows = await this.store.list<Room>('room', { afterSeq, order: 'asc', includeArchived: true, limit: 50 })
      for (const row of rows) {
        found = true
        if (row.value.members.every((member) => Boolean(member.participantAgentId))) continue
        const prepared = await this.prepareRoom({ ...row.value, revision: row.revision })
        await this.store.commit({ requestId: agentStableId('agent-migrate', row.id, String(row.revision)),
          checks: [{ kind: 'room', id: row.id, expectedRevision: row.revision }, ...prepared.checks],
          puts: [...prepared.puts, { kind: 'room', id: row.id, roomId: row.id,
            value: { ...prepared.room, revision: row.revision + 1 } }],
          events: [{ roomId: row.id, kind: 'room.updated', payload: { id: row.id } }] })
      }
      if (rows.length < 50) break
      afterSeq = rows.at(-1)!.seq
    }
    const fresh = !found && !(await this.store.list('agent_identity', { includeArchived: true, limit: 1 })).length
    await this.store.commit({ requestId: 'agent-bootstrap:identities-v1',
      checks: [{ kind: 'agent_bootstrap', id: 'identities-v1', expectedRevision: null }],
      puts: [{ kind: 'agent_bootstrap', id: 'identities-v1', value: { completedAt: new Date().toISOString(), fresh } }] })
  }
  async get(id: string): Promise<AgentIdentity> {
    const row = await this.store.get<AgentIdentity>('agent_identity', id)
    if (!row) throw new Error('agent not found')
    return AgentIdentitySchema.parse({ ...row.value, revision: row.revision })
  }
  async active(id: string): Promise<AgentIdentity> {
    const agent = await this.get(id)
    if (agent.archivedAt) throw new RoomStoreConflictError('agent is archived')
    return agent
  }
  async list(raw: unknown = {}): Promise<AgentPage> {
    const input = AgentPageQuery.parse(raw)
    const rows = await this.store.list<AgentIdentity>('agent_identity', {
      limit: input.limit + 1, beforeSeq: input.cursor, search: input.search, archivedOnly: input.archivedOnly })
    return { agents: rows.slice(0, input.limit).map((row) => AgentIdentitySchema.parse({ ...row.value, revision: row.revision })),
      ...(rows.length > input.limit ? { nextCursor: String(rows[input.limit - 1].seq) } : {}) }
  }
  async create(raw: unknown): Promise<{ agent: AgentIdentity }> {
    const input = CreateAgentRequest.parse(raw)
    const key = 'agent-create:' + input.clientRequestId, hash = fingerprint(input)
    const replay = await this.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== hash) throw new RoomStoreConflictError('agent request changed')
      return replay.result as { agent: AgentIdentity }
    }
    if (!(await this.features()).identities) throw new RoomStoreConflictError('agent creation is disabled')
    const copy = input.copyFromAgentId ? await this.get(input.copyFromAgentId) : undefined
    const { clientRequestId: _, copyFromAgentId: __, ...fields } = input
    const now = new Date().toISOString()
    const agent = AgentIdentitySchema.parse({ ...(copy ?? {}), ...fields,
      ...(copy ? { title: copy.title, instructions: copy.instructions, defaultRole: copy.defaultRole,
        presetId: copy.presetId, avatar: input.avatar ?? copy.avatar, modelRef: copy.modelRef, fastModelRef: copy.fastModelRef,
        capabilityOverrides: copy.capabilityOverrides, allowedRepositoryRoots: copy.allowedRepositoryRoots,
        reviewerAgentId: copy.reviewerAgentId, memory: copy.memory } : {}),
      id: 'agent-' + randomUUID(), schemaVersion: 1, revision: 0, createdAt: now, updatedAt: now,
      archivedAt: undefined, migratedFrom: undefined,
      setup: copy ? undefined : { status: 'completed' as const, startedAt: now, completedAt: now } })
    await this.validate(agent)
    const result = { agent }
    const saved = await this.store.commit({ requestId: key, fingerprint: hash,
      checks: [{ kind: 'agent_identity', id: agent.id, expectedRevision: null }],
      puts: [{ kind: 'agent_identity', id: agent.id, value: agent }], result,
      events: [{ roomId: namespace, kind: 'agent.created', payload: { id: agent.id } }] })
    return saved.result as typeof result
  }
  async update(id: string, raw: unknown): Promise<{ agent: AgentIdentity }> {
    const parsed = UpdateAgentRequest.parse(raw)
    // Zod defaults inside optional fields must not turn a partial update into a reset.
    const input = Object.fromEntries(Object.entries(parsed).filter(([key]) =>
      Object.hasOwn(raw as object, key))) as typeof parsed
    const hash = fingerprint(input)
    const key = 'agent-update:' + id + ':' + input.clientRequestId
    const replay = await this.store.getRequest(key)
    if (replay) {
      if (replay.fingerprint !== hash) throw new RoomStoreConflictError('agent request changed')
      return replay.result as { agent: AgentIdentity }
    }
    const old = await this.get(id)
    const { clientRequestId: _, expectedRevision, archived, ...patch } = input
    const normalizedPatch = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === null ? undefined : value]))
    const now = new Date().toISOString()
    const takeover = old.setup?.status === 'pending' && !Object.hasOwn(raw as object, 'setup') &&
      ['name', 'title', 'instructions'].some((key) => Object.hasOwn(raw as object, key) &&
        String((normalizedPatch as Record<string, unknown>)[key] ?? '') !== String((old as Record<string, unknown>)[key] ?? ''))
    const agent = AgentIdentitySchema.parse({ ...old, ...normalizedPatch, revision: expectedRevision + 1,
      updatedAt: now, ...(archived === undefined ? {} : {
        archivedAt: archived ? now : undefined }),
      ...(takeover ? { setup: { status: 'skipped', startedAt: old.setup!.startedAt, completedAt: now } } : {}) })
    await this.validate(agent)
    const saved = await this.store.commit({ requestId: key, fingerprint: hash,
      checks: [{ kind: 'agent_identity', id, expectedRevision }],
      puts: [{ kind: 'agent_identity', id, value: agent }], result: { agent },
      events: [{ roomId: namespace, kind: 'agent.updated', payload: { id } }] })
    return saved.result as { agent: AgentIdentity }
  }
  private async validate(agent: AgentIdentity) {
    if (agent.allowedRepositoryRoots) {
      const repositories = await Promise.all(agent.allowedRepositoryRoots.map((root) => observeRoomRepository(root)))
      agent.allowedRepositoryRoots = [...new Set(repositories.map((repo) => repo.root))]
    }
    if (agent.reviewerAgentId) {
      if (agent.reviewerAgentId === agent.id) throw new RoomStoreConflictError('an agent cannot review its own work')
      await this.active(agent.reviewerAgentId)
    }
    if (agent.avatar?.kind === 'uploaded') {
      if (!this.validateAvatars) throw new Error('avatar storage unavailable')
      await this.validateAvatars([this.asMember(agent)])
    }
  }
  asMember(agent: AgentIdentity, repositoryIds: string[] = []): RoomMember {
    return RoomMemberSchema.parse({ id: agent.id, participantAgentId: agent.id, displayName: agent.name, agentTitle: agent.title,
      presetId: agent.presetId, role: agent.defaultRole, avatar: agent.avatar, revision: 0,
      allowedRepositoryIds: repositoryIds, ...(repositoryIds.length === 1 ? { defaultRepositoryId: repositoryIds[0] } : {}) })
  }
  async defaultMembers(repositoryIds: string[]): Promise<RoomMember[]> {
    const members: RoomMember[] = []
    for (const template of DEFAULT_AGENT_TEMPLATES) {
      const id = 'agent-default-' + template.templateId
      let row = await this.store.get<AgentIdentity>('agent_identity', id)
      if (!row) {
        const now = new Date().toISOString()
        const { examples: _examples, ...fields } = template
        const agent = AgentIdentitySchema.parse({ ...fields, schemaVersion: 1, id, revision: 0, createdAt: now, updatedAt: now })
        await this.store.commit({ requestId: 'agent-default:' + id,
          checks: [{ kind: 'agent_identity', id, expectedRevision: null }],
          puts: [{ kind: 'agent_identity', id, value: agent }] })
        row = await this.store.get<AgentIdentity>('agent_identity', id)
      }
      if (!row!.value.archivedAt) members.push({ ...this.asMember(row!.value, repositoryIds), id: template.templateId })
    }
    if (!members.length) throw new RoomStoreConflictError('choose an active agent for the room')
    return members
  }
  async present(room: Room): Promise<Room> {
    const members = await Promise.all(room.members.map(async (member) => {
      if (!member.participantAgentId) return member
      const row = await this.store.get<AgentIdentity>('agent_identity', member.participantAgentId)
      return row ? { ...member, displayName: row.value.name, avatar: row.value.avatar, agentTitle: row.value.title } : member
    }))
    return { ...room, members,
      ...(room.conversationKind === 'user_agent' ? { name: members[0].displayName } : {}) }
  }
  prepareRoom(room: Room, previous?: Room): Promise<{
    room: Room; checks: NonNullable<RoomStoreCommit['checks']>; puts: NonNullable<RoomStoreCommit['puts']>
  }> { return bindAgentMembers(this, room, previous) }
  freeze(room: Room): Promise<Room> { return freezeAgentRoom(this, room) }
}
