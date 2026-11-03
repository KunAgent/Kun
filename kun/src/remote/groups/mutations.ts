import { canonical } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { RoomSchema, type Room, type RoomMember } from '../../contracts/rooms.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { assertRoomMemberRemovalAllowed } from '../../rooms/room-member-dependencies.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import { requireRemoteScope, type RemoteAuthority } from '../authorization/scopes.js'
import { GroupWriteParamSchemas, type GroupWriteMethod } from './contracts.js'
import { RemoteGroupTargetError, publicGroup } from './projection.js'

export class RemoteGroupMutations {
  constructor(private runtime: ServerRuntime, private group: (scope: RemoteAuthority, id: string) => Promise<Room>) {}
  private authorize(scope: RemoteAuthority) { requireRemoteScope(scope, 'groups.read'); requireRemoteScope(scope, 'groups.write') }
  private async agent(id: string) {
    const directory = this.runtime.rooms!.agents
    const row = await directory.store.get('agent_identity', id)
    if (!row) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    const agent = await directory.get(id)
    if (agent.archivedAt) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    return agent
  }
  private async requireGroup(scope: RemoteAuthority, id: string) {
    try { return await this.group(scope, id) } catch (error) {
      if (error instanceof RemoteGroupTargetError)
        throw new RemoteNoEffect(error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST')
      throw error
    }
  }
  private async create(p: any) {
    const agents = await Promise.all(p.participantAgentIds.map((id: string) => this.agent(id)))
    const leader = p.defaultAgentId ? agents.find((agent) => agent.id === p.defaultAgentId) : agents.find((agent) => !agent.executor)
    if (!leader || leader.executor) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    return { name: p.name, ...(p.description !== undefined ? { description: p.description } : {}),
      collaborationMode: p.collaborationMode ?? 'peer', maxConcurrentTasks: p.maxConcurrentTasks ?? 2,
      defaultMemberId: leader.id, members: agents.map((agent) => this.runtime.rooms!.agents.asMember(agent)), repositories: [] }
  }
  private async patch(method: GroupWriteMethod, room: Room, p: any) {
    if (method === 'group.archive') return { archived: true }
    if (method === 'group.restore') return { archived: false }
    if (method === 'group.update') {
      const { roomId: _roomId, expectedRevision: _revision, ...fields } = p
      return fields
    }
    let members = room.members.map((member) => ({ ...member })), changed: RoomMember | undefined
    if (method === 'group.member.add') {
      const agent = await this.agent(p.agentId), existing = members.find((member) => member.participantAgentId === p.agentId)
      if (existing && !existing.removedAt) throw new RemoteNoEffect('INVALID_REQUEST')
      if (existing) {
        changed = { ...existing, enabled: true, removedAt: undefined, revision: existing.revision + 1 }
        members = members.map((member) => member.id === existing.id ? changed! : member)
      } else {
        if (members.length >= 100) throw new RemoteNoEffect('INVALID_REQUEST')
        // New membership grants no repository roots. Existing Agent policies stay authoritative.
        changed = this.runtime.rooms!.agents.asMember(agent)
        members.push(changed)
      }
    } else {
      const current = members.find((member) => member.id === p.memberId && !member.removedAt)
      if (!current) throw new RemoteNoEffect('NOT_FOUND')
      if (method === 'group.member.update' && p.enabled && current.participantAgentId) await this.agent(current.participantAgentId)
      changed = { ...current, enabled: method === 'group.member.remove' ? false : p.enabled, revision: current.revision + 1,
        ...(method === 'group.member.remove' ? { removedAt: new Date().toISOString() } : {}) }
      members = members.map((member) => member.id === current.id ? changed! : member)
    }
    return { members, ...(p.defaultMemberId ? { defaultMemberId: p.defaultMemberId } : {}) }
  }
  private async prepare(method: GroupWriteMethod, p: any, scope: RemoteAuthority) {
    if (method === 'group.create') return this.create(p)
    const room = await this.requireGroup(scope, p.roomId)
    if (room.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
    const patch = await this.patch(method, room, p)
    if (method === 'group.archive' || method === 'group.restore') return patch
    const parsed = RoomSchema.safeParse({ ...room, ...patch })
    if (!parsed.success) throw new RemoteNoEffect('INVALID_REQUEST')
    const leader = parsed.data.members.find((member) => member.id === parsed.data.defaultMemberId)!
    if (p.defaultMemberId && leader.participantAgentId && (await this.agent(leader.participantAgentId)).executor)
      throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    if (method === 'group.member.remove') {
      try { await assertRoomMemberRemovalAllowed(this.runtime.rooms!.deps.store, room, parsed.data) }
      catch (error) { if (error instanceof RoomStoreConflictError) throw new RemoteNoEffect('TASK_BUSY'); throw error }
    }
    return patch
  }
  async preflight(method: string, raw: unknown, scope: RemoteAuthority) {
    this.authorize(scope)
    if (!Object.hasOwn(GroupWriteParamSchemas, method)) throw new RemoteNoEffect('INVALID_REQUEST')
    const name = method as GroupWriteMethod, p = GroupWriteParamSchemas[name].parse(raw)
    await this.prepare(name, p, scope)
  }
  private nativeKey(scope: RemoteAuthority, method: string, params: Record<string, unknown>, requestId: string) {
    return method === 'group.create' ? 'room-create:' + receiptKey(scope, requestId)
      : 'room-update:' + String(params.roomId) + ':' + receiptKey(scope, requestId)
  }
  private async prior(scope: RemoteAuthority, method: string, p: Record<string, unknown>, requestId: string) {
    const old = await this.runtime.rooms!.deps.store.getRequest(this.nativeKey(scope, method, p, requestId))
    if (!old) return undefined
    const result = old.result as { room?: unknown } | undefined, room = RoomSchema.safeParse(result?.room)
    if (!room.success || room.data.conversationKind !== 'group') throw new Error('INVALID_GROUP_RECEIPT')
    return { group: await publicGroup(this.runtime, room.data) }
  }
  async mutate(scope: RemoteAuthority, method: string, raw: unknown, requestId: string) {
    this.authorize(scope)
    if (!Object.hasOwn(GroupWriteParamSchemas, method)) throw new RemoteNoEffect('INVALID_REQUEST')
    const name = method as GroupWriteMethod, p = GroupWriteParamSchemas[name].parse(raw)
    const rooms = this.runtime.rooms!, clientRequestId = receiptKey(scope, requestId)
    const result = await rooms.exclusive(async () => {
      // The outer durable receipt establishes request/body identity. Never reconstruct a replay from current membership.
      const receipt = await rooms.deps.store.get<Receipt>('remote_receipt', clientRequestId)
      if (receipt && (receipt.value.method !== method || canonical(GroupWriteParamSchemas[name].parse(receipt.value.params)) !== canonical(p)))
        throw new Error('REQUEST_CONFLICT')
      const prior = await this.prior(scope, name, p, requestId)
      if (prior) return prior
      const fields = await this.prepare(name, p, scope)
      try {
        const saved = name === 'group.create' ? await rooms.service.create({ ...fields, clientRequestId })
          : await rooms.service.update((p as { roomId: string }).roomId, { ...fields, clientRequestId,
            expectedRevision: (p as { expectedRevision: number }).expectedRevision })
        return { group: await publicGroup(this.runtime, saved.room) }
      } catch (error) {
        if (error instanceof RoomStoreConflictError && error.currentRevision !== null) throw new RemoteNoEffect('REVISION_CONFLICT')
        throw error
      }
    })
    rooms.wake()
    return result
  }
  async recover(scope: RemoteAuthority, receipt: Receipt) {
    requireRemoteScope(scope, 'groups.read')
    if (!Object.hasOwn(GroupWriteParamSchemas, receipt.method) || !receipt.params) return undefined
    const p = GroupWriteParamSchemas[receipt.method as GroupWriteMethod].parse(receipt.params)
    return this.prior(scope, receipt.method, p, receipt.requestId)
  }
}
