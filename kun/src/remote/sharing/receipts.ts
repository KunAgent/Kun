import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { ShareActor, ShareGuestCall } from './contracts.js'
import { shareDigest } from './journal.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import type { RoomStoreCommit } from '../../rooms/room-store.js'
export type SharedExternalCall = { requestId: string; expiresAt: number; method: string; params: Record<string, unknown> }
export type SharedReceipt = { origin: Pick<ShareActor, 'ownerAccountId' | 'hostDeviceId' | 'shareId' | 'memberId' | 'guestAccountId' | 'deviceId' | 'shareVersion' | 'memberVersion'>; requestId: string; method: string; params: Record<string, unknown>; fingerprint: string;
  status: 'accepted' | 'applied' | 'reconciliation_required'; createdAt: number; result?: unknown; error?: { code: string; definitive: true } }
const keyFor = (actor: ShareActor, id: string) => 'share-guest_' + shareDigest([actor.ownerAccountId, actor.hostDeviceId,
  actor.shareId, actor.memberId, actor.guestAccountId, actor.deviceId, id])
/** Separate namespace. Authorization generation fences admission but never changes the durable request identity. */
export class SharedTaskReceipts {
  private flights = new Map<string, Promise<SharedReceipt>>()
  constructor(private runtime: ServerRuntime) {}
  async get(actor: ShareActor, id: string) {
    const key = keyFor(actor, id), row = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
    if (!row) return null
    return row.value.status === 'accepted' && !this.flights.has(key) ? { ...row.value, status: 'reconciliation_required' as const } : row.value
  }
  async recovered(actor: ShareActor, id: string, result: unknown) {
    return this.runtime.rooms!.exclusive(async () => {
      const key = keyFor(actor, id), row = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
      if (!row || row.value.status === 'applied') return row?.value ?? null
      const value: SharedReceipt = { ...row.value, status: 'applied', result }
      await this.runtime.rooms!.deps.store.commit({ requestId: key + '-recover', checks: [{ kind: 'shared_receipt', id: key, expectedRevision: row.revision }],
        puts: [{ kind: 'shared_receipt', id: key, taskId: actor.shareId, value }] })
      return value
    })
  }
  /** Main may perform bounded native file work only after this durable admission. Duplicates never restart it. */
  async startExternal(actor: ShareActor, call: SharedExternalCall) {
    return this.runtime.rooms!.exclusive(async () => {
      const key = keyFor(actor, call.requestId), fingerprint = shareDigest({ method: call.method, params: call.params })
      const old = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
      if (old) {
        if (old.value.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT')
        return { receipt: old.value.status === 'accepted' ? { ...old.value, status: 'reconciliation_required' as const } : old.value }
      }
      if (call.expiresAt <= Date.now() || call.expiresAt > Date.now() + 300000) throw new Error('REQUEST_EXPIRED')
      const { ownerAccountId, hostDeviceId, shareId, memberId, guestAccountId, deviceId, shareVersion, memberVersion } = actor
      const value: SharedReceipt = { origin: { ownerAccountId, hostDeviceId, shareId, memberId, guestAccountId, deviceId, shareVersion, memberVersion },
        requestId: call.requestId, method: call.method, params: call.params, fingerprint, status: 'accepted', createdAt: Date.now() }
      await this.runtime.rooms!.deps.store.commit({ requestId: key + '-accept', checks: [{ kind: 'shared_receipt', id: key, expectedRevision: null }],
        puts: [{ kind: 'shared_receipt', id: key, taskId: actor.shareId, value }] })
      return { started: true as const }
    })
  }
  /** Admission proof and receipt settle in one Manager transaction, after the caller revalidates native custody. */
  async finishExternal(actor: ShareActor, call: SharedExternalCall, result: unknown,
    proof: (receipt: SharedReceipt) => Promise<Pick<RoomStoreCommit, 'checks' | 'puts'>> = async () => ({})) {
    return this.runtime.rooms!.exclusive(async () => {
      const key = keyFor(actor, call.requestId), row = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
      if (!row) throw new Error('RECEIPT_REQUIRED')
      if (row.value.fingerprint !== shareDigest({ method: call.method, params: call.params })) throw new Error('REQUEST_CONFLICT')
      if (row.value.status === 'applied') return { receipt: row.value }
      if (row.value.error?.definitive) throw new Error('RECEIPT_CONFLICT')
      const extra = await proof(row.value), value: SharedReceipt = { ...row.value, status: 'applied', result }
      await this.runtime.rooms!.deps.store.commit({ requestId: key + '-external-finish', checks: [
        { kind: 'shared_receipt', id: key, expectedRevision: row.revision }, ...(extra.checks ?? [])],
        puts: [{ kind: 'shared_receipt', id: key, taskId: actor.shareId, value }, ...(extra.puts ?? [])] })
      return { receipt: value }
    })
  }
  execute(actor: ShareActor, call: ShareGuestCall, run: () => Promise<unknown>) {
    const key = keyFor(actor, call.requestId), fingerprint = shareDigest({ method: call.method, params: call.params })
    const flight = this.flights.get(key)
    if (flight) return flight.then((receipt) => { if (receipt.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT'); return receipt })
    const operation = (async () => {
      const admitted = await this.runtime.rooms!.exclusive(async () => {
        const old = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
        if (old) {
          if (old.value.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT')
          return { receipt: old.value.status === 'accepted' ? { ...old.value, status: 'reconciliation_required' as const } : old.value, fresh: false }
        }
        if (call.expiresAt <= Date.now() || call.expiresAt > Date.now() + 300000) throw new Error('REQUEST_EXPIRED')
        const receipt: SharedReceipt = { origin: { ownerAccountId: actor.ownerAccountId, hostDeviceId: actor.hostDeviceId, shareId: actor.shareId, memberId: actor.memberId, guestAccountId: actor.guestAccountId, deviceId: actor.deviceId, shareVersion: actor.shareVersion, memberVersion: actor.memberVersion }, requestId: call.requestId, method: call.method, params: call.params, fingerprint,
          createdAt: Date.now(), status: 'accepted' }
        await this.runtime.rooms!.deps.store.commit({ requestId: key + '-accept', checks: [{ kind: 'shared_receipt', id: key, expectedRevision: null }],
          puts: [{ kind: 'shared_receipt', id: key, taskId: actor.shareId, value: receipt }] })
        return { receipt, fresh: true }
      })
      if (!admitted.fresh) return admitted.receipt
      let value: SharedReceipt
      try { value = { ...admitted.receipt, status: 'applied', result: await run() } }
      catch (error) { value = { ...admitted.receipt, status: 'reconciliation_required',
        ...(error instanceof RemoteNoEffect ? { error: { code: error.code, definitive: true as const } } : {}) } }
      try {
        await this.runtime.rooms!.exclusive(async () => {
          const old = await this.runtime.rooms!.deps.store.get<SharedReceipt>('shared_receipt', key)
          if (!old || old.value.status !== 'accepted') throw new Error('RECEIPT_CONFLICT')
          await this.runtime.rooms!.deps.store.commit({ requestId: key + '-finish', checks: [{ kind: 'shared_receipt', id: key, expectedRevision: old.revision }],
            puts: [{ kind: 'shared_receipt', id: key, taskId: actor.shareId, value }] })
        })
      } catch { return { ...admitted.receipt, status: 'reconciliation_required' as const } }
      return value
    })()
    this.flights.set(key, operation)
    void operation.finally(() => { if (this.flights.get(key) === operation) this.flights.delete(key) }).catch(() => {})
    return operation
  }
}
