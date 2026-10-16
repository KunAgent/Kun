import { createHash } from 'node:crypto'
import { canonical, type Call, type RemoteApi } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
export type ShareOwner = { ownerAccountId: string; hostDeviceId: string; controllerId: string }
type OwnerContext = { api: RemoteApi; owner: ShareOwner; current(): boolean; lease(): Promise<ProtectedRuntimeRequestLease> }
export async function shareLease(acquire: () => Promise<ProtectedRuntimeRequestLease>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([acquire(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RUNTIME_TIMEOUT')), 15000) })]) }
  finally { clearTimeout(timer) }
}
export async function shareRuntime(lease: ProtectedRuntimeRequestLease, path: string, value: unknown): Promise<any> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const response = await Promise.race([lease.request('/v1/remote/shares/' + path, 'POST', JSON.stringify(value)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('RUNTIME_TIMEOUT')), 15000) })]).finally(() => clearTimeout(timer))
  let result: any
  try { result = JSON.parse(response.body) } catch { throw new Error('RUNTIME_REJECTED') }
  if (!response.ok) throw new Error(typeof result.code === 'string' ? result.code : 'RUNTIME_REJECTED')
  return result
}
const fingerprint = (scope: ShareOwner, id?: string) => createHash('sha256').update(JSON.stringify([scope.ownerAccountId, scope.hostDeviceId, scope.controllerId, id])).digest('hex')
/** Stable cloud native proofs reconcile management writes; no invitation plaintext enters this module. */
export class ShareOwnerOperations {
  private flights = new Map<string, { fingerprint: string; task: Promise<unknown> }>()
  async list(context: OwnerContext, params: { threadId?: string; cursor?: string; limit?: number }) {
    const value = await context.api.request<any>('/shares'), rows: any[] = [], lease = await context.lease()
    if (!context.current()) throw new Error('ACCOUNT_CHANGED')
    for (const share of (Array.isArray(value.owned) ? value.owned : []).slice(0, 5)) {
      if (share.ownerAccountId !== context.owner.ownerAccountId || share.hostDeviceId !== context.owner.hostDeviceId) continue
      const local = await shareRuntime(lease, 'resource', { owner: context.owner, resourceHandle: share.resourceHandle })
      if (!context.current()) throw new Error('ACCOUNT_CHANGED')
      if (!local.resource || params.threadId && local.resource.threadId !== params.threadId) continue
      await shareRuntime(lease, 'resource-bind', { owner: context.owner, share })
      const detail = await context.api.request<any>('/shares/' + share.id)
      if (!context.current()) throw new Error('ACCOUNT_CHANGED')
      rows.push({ share, threadId: local.resource.threadId, title: local.title ?? 'Shared task',
        ...(Array.isArray(detail.members) ? { members: detail.members.slice(0, 2).map((member: any) => ({ id: member.id, accountId: member.accountId, mode: member.mode, version: member.version, state: member.state })) } : {}) })
    }
    rows.sort((a, b) => a.share.id.localeCompare(b.share.id))
    const scope = fingerprint(context.owner, params.threadId), limit = params.limit ?? 20
    let offset = 0
    if (params.cursor) {
      try { const position = JSON.parse(Buffer.from(params.cursor, 'base64url').toString()); if (position.scope !== scope || !Number.isSafeInteger(position.offset) || position.offset < 0) throw new Error(); offset = position.offset }
      catch { throw new Error('INVALID_CURSOR') }
    }
    const hasMore = rows.length > offset + limit
    return { shares: rows.slice(offset, offset + limit), hasMore,
      nextCursor: hasMore ? Buffer.from(JSON.stringify({ scope, offset: offset + limit })).toString('base64url') : undefined }
  }
  async lookup(context: OwnerContext, requestId: string): Promise<any> {
    const lease = await context.lease(), local = await shareRuntime(lease, 'owner-lookup', { owner: context.owner, requestId })
    if (!local.receipt) return null
    if (local.receipt.status === 'applied') return local
    try {
      const proof = await context.api.request<any>('/shares/requests/' + local.receipt.cloudRequestId)
      if (!context.current()) throw new Error('ACCOUNT_CHANGED')
      if (proof.result) return shareRuntime(lease, 'owner-settle', { owner: context.owner, requestId, result: proof.result })
    } catch { /* Unknown cloud outcome is never retried as a management mutation. */ }
    return { receipt: { ...local.receipt, status: 'reconciliation_required' } }
  }
  invoke(context: OwnerContext, call: Call, changed: () => void) {
    const id = fingerprint(context.owner, call.requestId), flight = this.flights.get(id)
    const content = canonical({ method: call.method, params: call.params })
    if (flight) { if (flight.fingerprint !== content) throw new Error('REQUEST_CONFLICT'); return flight.task }
    if (call.expiresAt <= Date.now() || call.expiresAt > Date.now() + 300000) throw new Error('REQUEST_EXPIRED')
    const operation = this.perform(context, call, changed)
    this.flights.set(id, { fingerprint: content, task: operation })
    void operation.finally(() => { if (this.flights.get(id)?.task === operation) this.flights.delete(id) }).catch(() => {})
    return operation
  }
  private async perform(context: OwnerContext, call: Call, changed: () => void) {
    const lease = await context.lease(), local = await shareRuntime(lease, 'owner-prepare', {
      owner: context.owner, requestId: call.requestId, params: call.params })
    if (!context.current()) throw new Error('ACCOUNT_CHANGED')
    if (!local.fresh) return this.lookup(context, call.requestId)
    const p = call.params as any, requestId = local.receipt.cloudRequestId
    // Receipt + fail-closed fence are durable before any cloud request is sent.
    changed()
    let result: unknown
    try {
      switch (p.action) {
        case 'create': result = await context.api.request('/shares', 'POST', { requestId, resourceHandle: local.receipt.resourceHandle, ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}) }); break
        case 'invite': result = await context.api.request('/shares/' + p.shareId + '/invites', 'POST', { requestId, expectedVersion: p.expectedVersion,
          invitationHash: p.invitationHash, mode: p.mode, ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}) }); break
        case 'member.update': result = await context.api.request('/shares/' + p.shareId + '/members/' + p.memberId, 'PATCH', { requestId, expectedVersion: p.expectedVersion, mode: p.mode }); break
        case 'revoke': result = await context.api.request('/shares/' + p.shareId + '/members/' + p.memberId, 'DELETE', { requestId, expectedVersion: p.expectedVersion }); break
        case 'close': result = await context.api.request('/shares/' + p.shareId, 'DELETE', { requestId, expectedVersion: p.expectedVersion }); break
        default: throw new Error('INVALID_REQUEST')
      }
      if (!context.current()) throw new Error('ACCOUNT_CHANGED')
      const settled = await shareRuntime(lease, 'owner-settle', { owner: context.owner, requestId: call.requestId, result })
      changed()
      return settled
    } catch { return { receipt: { ...local.receipt, status: 'reconciliation_required' } } }
  }
}
