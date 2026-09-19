import { AgentIdentitySchema, type AgentIdentity } from '../contracts/agent-identities.js'
import { RoomMemberSchema, RoomSchema, type Room } from '../contracts/rooms.js'
import type { RoomStoreCommit } from '../rooms/room-store.js'
import { RoomStoreConflictError } from '../rooms/room-store.js'
import { agentStableId, type AgentIdentityService } from './agent-identity-service.js'

export async function bindAgentMembers(directory: AgentIdentityService, room: Room, previous?: Room) {
  const checks: NonNullable<RoomStoreCommit['checks']> = []
  const puts: NonNullable<RoomStoreCommit['puts']> = []
  const members = []
  for (const member of room.members) {
    const before = previous?.members.find((item) => item.id === member.id)
    if (before?.participantAgentId && member.participantAgentId && before.participantAgentId !== member.participantAgentId) throw new RoomStoreConflictError('agent membership identity cannot change')
    const id = member.participantAgentId ?? before?.participantAgentId ?? agentStableId('agent-member', room.id, member.id)
    const row = await directory.store.get<AgentIdentity>('agent_identity', id)
    if (!row) {
      if (member.participantAgentId || before?.participantAgentId) throw new Error('agent not found')
      const now = new Date().toISOString()
      const agent = AgentIdentitySchema.parse({ id, schemaVersion: 1, name: member.displayName,
        defaultRole: member.role, presetId: member.presetId, avatar: member.avatar,
        modelRef: member.modelRef, capabilityOverrides: member.capabilityOverrides,
        allowedRepositoryRoots: room.repositories.filter((repo) => member.allowedRepositoryIds.includes(repo.id)).map((repo) => repo.canonicalRoot),
        instructions: '', revision: 0, createdAt: now, updatedAt: now,
        archivedAt: member.removedAt,
        migratedFrom: { roomId: room.id, memberId: member.id, roomName: room.name } })
      checks.push({ kind: 'agent_identity', id, expectedRevision: null })
      puts.push({ kind: 'agent_identity', id, value: agent })
      const mapping = agentStableId('agent-mapping', room.id, member.id)
      checks.push({ kind: 'agent_mapping', id: mapping, expectedRevision: null })
      puts.push({ kind: 'agent_mapping', id: mapping, roomId: room.id,
        value: { roomId: room.id, memberId: member.id, participantAgentId: id } })
    } else {
      if (row.value.archivedAt && !member.removedAt && (!before || before.participantAgentId !== id)) {
        throw new RoomStoreConflictError('cannot invite an archived agent')
      }
      const roots = row.value.allowedRepositoryRoots
      if (roots && room.repositories.some((repo) => member.allowedRepositoryIds.includes(repo.id) && !roots.includes(repo.canonicalRoot))) {
        throw new RoomStoreConflictError('repository is outside the agent scope')
      }
      checks.push({ kind: 'agent_identity', id, expectedRevision: row.revision })
      if (!row.value.modelRef && member.modelRef) {
        puts.push({ kind: 'agent_identity', id, value: AgentIdentitySchema.parse({
          ...row.value, modelRef: member.modelRef, revision: row.revision + 1, updatedAt: new Date().toISOString() }) })
      }
    }
    const { modelRef: _modelRef, ...rest } = member
    members.push(RoomMemberSchema.parse({ ...rest, participantAgentId: id,
      agentRevision: undefined, agentInstructions: undefined, presetSnapshot: undefined,
      configuredReviewerAgentId: undefined, taskScopedMemory: undefined }))
  }
  return { room: RoomSchema.parse({ ...room, conversationKind: room.conversationKind ?? 'group',
    participantAgentIds: members.filter((member) => !member.removedAt).map((member) => member.participantAgentId!),
    members }), checks, puts }
}

export async function freezeAgentRoom(directory: AgentIdentityService, room: Room): Promise<Room> {
  const members = []
  for (const member of room.members) {
    if (!member.participantAgentId) { members.push(member); continue }
    const agent = await directory.get(member.participantAgentId)
    const profile = directory.profiles()[agent.presetId] ?? null
    const a = agent.capabilityOverrides, b = member.capabilityOverrides
    const allowed = a?.allowedTools && b?.allowedTools ? a.allowedTools.filter((tool) => b.allowedTools!.includes(tool))
      : a?.allowedTools ?? b?.allowedTools
    const roots = agent.allowedRepositoryRoots
    const repositories = member.allowedRepositoryIds.filter((id) => !roots ||
      room.repositories.some((repo) => repo.id === id && roots.includes(repo.canonicalRoot)))
    members.push(RoomMemberSchema.parse({ ...member, displayName: agent.name, avatar: agent.avatar, agentTitle: agent.title,
      enabled: member.enabled && !agent.archivedAt, agentRevision: agent.revision,
      presetId: agent.presetId, presetSnapshot: profile, agentInstructions: agent.instructions,
      configuredReviewerAgentId: agent.reviewerAgentId, fastModelRef: agent.fastModelRef,
      modelRef: agent.modelRef,
      allowedRepositoryIds: repositories,
      defaultRepositoryId: repositories.includes(member.defaultRepositoryId ?? '') ? member.defaultRepositoryId : undefined,
      capabilityOverrides: { allowedTools: allowed,
        blockedTools: [...new Set([...(a?.blockedTools ?? []), ...(b?.blockedTools ?? [])])],
        blockedMcpServers: [...new Set([...(a?.blockedMcpServers ?? []), ...(b?.blockedMcpServers ?? [])])],
        blockedSkills: [...new Set([...(a?.blockedSkills ?? []), ...(b?.blockedSkills ?? [])])],
        skillsEnabled: a?.skillsEnabled !== false && b?.skillsEnabled !== false } }))
  }
  if (!members.some((member) => member.id === room.defaultMemberId && member.enabled && !member.removedAt)) {
    throw new RoomStoreConflictError('the default agent is unavailable; choose another agent')
  }
  return RoomSchema.parse({ ...room, members })
}
