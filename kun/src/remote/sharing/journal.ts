import { createHash, randomUUID } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { requireCode } from '../code/access.js'
import { ShareActorSchema, ShareManageSchema, ShareMemberSchema, ShareOwnerSchema, ShareSummarySchema,
  type ShareActor, type ShareManage, type ShareOwner } from './contracts.js'
export const shareDigest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
export type ShareResource = { ownerAccountId: string; hostDeviceId: string; resourceHandle: string; threadId: string;
  share?: import('zod').infer<typeof ShareSummarySchema>; createdAt: string;
  retiredSessions?: Array<{ id: string; expiresAt: number }>; admissionBlockedUntil?: number }
export type ShareOwnerReceipt = { origin: ShareOwner; requestId: string; cloudRequestId: string; params: ShareManage; fingerprint: string;
  resourceHandle?: string; method: 'shares.manage'; createdAt: number; status: 'accepted' | 'applied' | 'reconciliation_required'; result?: unknown }
const resourceKey = (owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, handle: string) => 'share-resource_' + shareDigest([owner.ownerAccountId, owner.hostDeviceId, handle])
const receiptKey = (owner: ShareOwner, id: string) => 'share-owner-' + shareDigest([owner.ownerAccountId, owner.hostDeviceId, owner.controllerId, id])
const blockKey = (owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, shareId: string, memberId?: string) => 'share-block_' + shareDigest([owner.ownerAccountId, owner.hostDeviceId, shareId, memberId ?? null])
const actorKey = (actor: ShareActor) => 'share-actor_' + shareDigest([actor.ownerAccountId, actor.hostDeviceId, actor.shareId, actor.memberId, actor.deviceId])
/** All physical writes go through the existing RoomStore / Manager transaction boundary. */
export class SharedTaskJournal {
  constructor(private runtime: ServerRuntime) {}
  private get rooms() { return this.runtime.rooms! }
  async resource(owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, handle: string) {
    return (await this.rooms.deps.store.get<ShareResource>('shared_resource', resourceKey(owner, handle)))?.value ?? null
  }
  private aliasKey(owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, shareId: string) {
    return 'share-id_' + shareDigest([owner.ownerAccountId, owner.hostDeviceId, shareId])
  }
  async byShare(owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, shareId: string) {
    const row = await this.rooms.deps.store.get<{ resourceHandle: string }>('shared_resource', this.aliasKey(owner, shareId))
    return row ? this.resource(owner, row.value.resourceHandle) : null
  }
  private async alias(owner: Pick<ShareOwner, 'ownerAccountId' | 'hostDeviceId'>, share: import('zod').infer<typeof ShareSummarySchema>) {
    const id = this.aliasKey(owner, share.id), row = await this.rooms.deps.store.get<{ resourceHandle: string }>('shared_resource', id)
    if (row && row.value.resourceHandle !== share.resourceHandle) throw new Error('SHARE_NOT_ALLOWED')
    return { check: { kind: 'shared_resource' as const, id, expectedRevision: row?.revision ?? null },
      put: { kind: 'shared_resource' as const, id, taskId: share.id, value: { resourceHandle: share.resourceHandle } } }
  }
  async bind(rawOwner: unknown, rawShare: unknown) {
    const owner = ShareOwnerSchema.parse(rawOwner), share = ShareSummarySchema.parse(rawShare)
    if (share.ownerAccountId !== owner.ownerAccountId || share.hostDeviceId !== owner.hostDeviceId) throw new Error('SHARE_NOT_ALLOWED')
    return this.rooms.exclusive(async () => {
      const key = resourceKey(owner, share.resourceHandle), row = await this.rooms.deps.store.get<ShareResource>('shared_resource', key)
      if (!row || row.value.share && row.value.share.id !== share.id) throw new Error('SHARE_NOT_ALLOWED')
      if (row.value.share && row.value.share.version >= share.version) return { resource: row.value }
      const resource = { ...row.value, share }, alias = await this.alias(owner, share)
      await this.rooms.deps.store.commit({ requestId: 'share-bind_' + randomUUID(),
        checks: [{ kind: 'shared_resource', id: key, expectedRevision: row.revision }, alias.check],
        puts: [{ kind: 'shared_resource', id: key, value: resource }, alias.put] })
      return { resource }
    })
  }
  async prepare(rawOwner: unknown, requestId: string, raw: unknown) {
    const owner = ShareOwnerSchema.parse(rawOwner), params = ShareManageSchema.parse(raw)
    const id = receiptKey(owner, requestId), fingerprint = shareDigest(params)
    return this.rooms.exclusive(async () => {
      const old = await this.rooms.deps.store.get<ShareOwnerReceipt>('shared_receipt', id)
      if (old) {
        if (old.value.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT')
        return { receipt: old.value, fresh: false }
      }
      let resource: ShareResource
      if (params.action === 'create') {
        const thread = await requireCode(this.runtime, params.threadId)
        if (thread.status === 'archived') throw new Error('TASK_ARCHIVED')
        resource = { ownerAccountId: owner.ownerAccountId, hostDeviceId: owner.hostDeviceId,
          resourceHandle: 'shared_' + randomUUID().replaceAll('-', ''), threadId: thread.id, createdAt: new Date().toISOString() }
      } else {
        const existing = await this.byShare(owner, params.shareId)
        if (!existing) throw new Error('NOT_FOUND')
        resource = existing
      }
      const blockId = ['revoke', 'close', 'member.update'].includes(params.action) ? blockKey(owner, 'shareId' in params ? params.shareId : '', 'memberId' in params ? params.memberId : undefined) : null
      const block = blockId ? await this.rooms.deps.store.get('shared_block', blockId) : null
      const receipt: ShareOwnerReceipt = { origin: owner, requestId, cloudRequestId: id, params, fingerprint, method: 'shares.manage', createdAt: Date.now(),
        resourceHandle: resource.resourceHandle, status: 'accepted' }
      await this.rooms.deps.store.commit({ requestId: id + '-prepare', checks: [
        { kind: 'shared_receipt', id, expectedRevision: null },
        ...(blockId ? [{ kind: 'shared_block' as const, id: blockId, expectedRevision: block?.revision ?? null }] : []),
        ...(params.action === 'create' ? [{ kind: 'shared_resource' as const, id: resourceKey(owner, resource.resourceHandle), expectedRevision: null }] : [])],
        puts: [{ kind: 'shared_receipt', id, value: receipt }, ...(blockId ? [{ kind: 'shared_block' as const, id: blockId, value: { blocked: true } }] : []), ...(params.action === 'create' ? [{
          kind: 'shared_resource' as const, id: resourceKey(owner, resource.resourceHandle), value: resource }] : [])] })
      return { receipt, fresh: true }
    })
  }
  async lookup(rawOwner: unknown, requestId: string) {
    const owner = ShareOwnerSchema.parse(rawOwner)
    return { receipt: (await this.rooms.deps.store.get<ShareOwnerReceipt>('shared_receipt', receiptKey(owner, requestId)))?.value ?? null }
  }
  async settle(rawOwner: unknown, requestId: string, rawResult: unknown) {
    const owner = ShareOwnerSchema.parse(rawOwner), result = rawResult as Record<string, unknown>
    const share = ShareSummarySchema.parse(result?.share)
    if (share.ownerAccountId !== owner.ownerAccountId || share.hostDeviceId !== owner.hostDeviceId) throw new Error('SHARE_NOT_ALLOWED')
    return this.rooms.exclusive(async () => {
      const id = receiptKey(owner, requestId), row = await this.rooms.deps.store.get<ShareOwnerReceipt>('shared_receipt', id)
      if (!row || row.value.resourceHandle !== share.resourceHandle) throw new Error('SHARE_NOT_ALLOWED')
      if (row.value.status === 'applied') return { receipt: row.value }
      const safeResult = { share, ...(Array.isArray(result.members) ? { members: result.members.map((m) => ShareMemberSchema.parse(m)) } : {}),
        ...(typeof result.inviteId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(result.inviteId) && ['read', 'write'].includes(String(result.mode)) && Number.isSafeInteger(result.expiresAt) ? { inviteId: result.inviteId, mode: result.mode as 'read' | 'write', expiresAt: result.expiresAt as number } : {}) }
      const key = resourceKey(owner, share.resourceHandle), resource = await this.rooms.deps.store.get<ShareResource>('shared_resource', key)
      if (!resource || resource.value.share && resource.value.share.id !== share.id) throw new Error('SHARE_NOT_ALLOWED')
      const alias = await this.alias(owner, share)
      const params = row.value.params
      const unblockId = params.action === 'member.update' && safeResult.members?.some((m) => m.id === params.memberId && m.state === 'active' && m.mode === params.mode && m.version > params.expectedVersion) ? blockKey(owner, share.id, params.memberId) : null
      const unblock = unblockId ? await this.rooms.deps.store.get('shared_block', unblockId) : null
      const title = params.action === 'create' ? (await requireCode(this.runtime, resource.value.threadId)).title : undefined
      const receipt = { ...row.value, status: 'applied' as const, result: { ...safeResult, ...(params.action === 'create' ? { threadId: resource.value.threadId, title } : {}) } }
      await this.rooms.deps.store.commit({ requestId: id + '-settle', checks: [
        { kind: 'shared_receipt', id, expectedRevision: row.revision }, { kind: 'shared_resource', id: key, expectedRevision: resource.revision }, alias.check,
        ...(unblockId ? [{ kind: 'shared_block' as const, id: unblockId, expectedRevision: unblock?.revision ?? null }] : [])],
        puts: [{ kind: 'shared_receipt', id, value: receipt }, ...(unblockId ? [{ kind: 'shared_block' as const, id: unblockId, value: { blocked: false } }] : []), alias.put, { kind: 'shared_resource', id: key,
          value: { ...resource.value, share: resource.value.share && resource.value.share.version > share.version ? resource.value.share : share } }] })
      return { receipt }
    })
  }
  private async blocked(actor: ShareActor) {
    const blocks = await Promise.all([blockKey(actor, actor.shareId), blockKey(actor, actor.shareId, actor.memberId)].map((key) => this.rooms.deps.store.get<{ blocked: boolean }>('shared_block', key)))
    return blocks.some((row) => row?.value.blocked)
  }
  private sessionFenced(resource: ShareResource, actor: ShareActor) {
    return (resource.admissionBlockedUntil ?? 0) > Date.now() || resource.retiredSessions?.some((session) => session.id === actor.sessionId && session.expiresAt > Date.now())
  }
  async admit(raw: unknown) {
    const actor = ShareActorSchema.parse(raw), key = actorKey(actor)
    return this.rooms.exclusive(async () => {
    if (await this.blocked(actor)) throw new Error('SHARE_AUTHORIZATION_STALE')
    const resource = await this.resource(actor, actor.resourceHandle)
    if (!resource?.share || this.sessionFenced(resource, actor) || resource.share.id !== actor.shareId || resource.share.state !== 'active' ||
        resource.share.expiresAt <= Date.now() || resource.share.version > actor.shareVersion || actor.expiresAt <= Date.now() || actor.expiresAt > Date.now() + 60000) throw new Error('SHARE_NOT_ALLOWED')
    await requireCode(this.runtime, resource.threadId)
    const old = await this.rooms.deps.store.get<ShareActor & { active: boolean }>('shared_actor', key)
    if (old && (old.value.memberVersion > actor.memberVersion || old.value.shareVersion > actor.shareVersion || old.value.expiresAt > actor.expiresAt ||
      old.value.expiresAt === actor.expiresAt && old.value.sessionId !== actor.sessionId && old.value.active)) throw new Error('SHARE_AUTHORIZATION_STALE')
    await this.rooms.deps.store.commit({ requestId: 'share-admit_' + randomUUID(), checks: [{ kind: 'shared_actor', id: key, expectedRevision: old?.revision ?? null }],
      puts: [{ kind: 'shared_actor', id: key, taskId: actor.shareId, value: { ...actor, active: true } }] })
    return { admitted: true }
    })
  }
  async authorize(raw: unknown) {
    const actor = ShareActorSchema.parse(raw)
    if (await this.blocked(actor)) throw new Error('SHARE_AUTHORIZATION_STALE')
    const row = await this.rooms.deps.store.get<ShareActor & { active: boolean }>('shared_actor', actorKey(actor))
    if (!row?.value.active || row.value.sessionId !== actor.sessionId || row.value.memberVersion !== actor.memberVersion ||
        row.value.shareVersion !== actor.shareVersion || row.value.guestAccountId !== actor.guestAccountId || row.value.resourceHandle !== actor.resourceHandle || row.value.mode !== actor.mode || row.value.expiresAt <= Date.now()) throw new Error('SHARE_AUTHORIZATION_STALE')
    const resource = await this.resource(actor, actor.resourceHandle)
    if (!resource?.share || this.sessionFenced(resource, actor) || resource.share.id !== actor.shareId || resource.share.state !== 'active' || resource.share.version > actor.shareVersion || resource.share.expiresAt <= Date.now()) throw new Error('SHARE_NOT_ALLOWED')
    return { actor, resource, thread: await requireCode(this.runtime, resource.threadId) }
  }
  async fence(rawOwner: unknown, shareId: string, memberId?: string, sessionId?: string) {
    const owner = ShareOwnerSchema.parse(rawOwner)
    return this.rooms.exclusive(async () => {
      const resource = await this.byShare(owner, shareId)
      if (!resource) return { fenced: true }
      const resourceId = resourceKey(owner, resource.resourceHandle), stored = await this.rooms.deps.store.get<ShareResource>('shared_resource', resourceId)
      const rows = await this.rooms.deps.store.list<ShareActor & { active: boolean }>('shared_actor', { taskId: shareId, limit: 100 })
      const targets = rows.filter((r) => r.value.ownerAccountId === owner.ownerAccountId && r.value.hostDeviceId === owner.hostDeviceId &&
        (!memberId || r.value.memberId === memberId) && (!sessionId || r.value.sessionId === sessionId))
      const retired = (resource.retiredSessions ?? []).filter((session) => session.expiresAt > Date.now())
      for (const id of new Set([...(sessionId ? [sessionId] : []), ...targets.map((r) => r.value.sessionId)]))
        if (!retired.some((session) => session.id === id)) retired.push({ id, expiresAt: Date.now() + 60000 })
      const overflow = retired.length > 256
      const next: ShareResource = { ...resource, retiredSessions: retired.slice(-256),
        ...(overflow ? { admissionBlockedUntil: Math.max(...retired.map((session) => session.expiresAt)) } : {}) }
      await this.rooms.deps.store.commit({ requestId: 'share-fence_' + randomUUID(), checks: [
        { kind: 'shared_resource', id: resourceId, expectedRevision: stored!.revision },
        ...targets.map((row) => ({ kind: 'shared_actor' as const, id: row.id, expectedRevision: row.revision }))],
        puts: [{ kind: 'shared_resource', id: resourceId, value: next }, ...targets.map((row) => ({
          kind: 'shared_actor' as const, id: row.id, taskId: shareId, value: { ...row.value, active: false } }))] })
      return { fenced: true }
    })
  }
}
