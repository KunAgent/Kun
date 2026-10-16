import { createHash } from 'node:crypto'
import { canonical } from '@kun/remote-protocol'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { RemoteNoEffect } from './rejections.js'
export interface Receipt {
  requestId: string
  method: string
  fingerprint: string
  params?: Record<string, unknown>
  status: 'accepted' | 'applied' | 'reconciliation_required'
  result?: unknown
  createdAt: number
  error?: { code: string; definitive: true }
}
export function receiptKey(scope: RemoteScope, id: string): string {
  return (
    'mobile-' +
    createHash('sha256')
      .update(scope.accountId + ':' + scope.deviceId + ':' + id)
      .digest('hex')
  )
}
export class RemoteReceipts {
  private flights = new Map<string, Promise<Receipt>>()
  constructor(private rooms: RoomRuntime) {}
  async get(scope: RemoteScope, id: string): Promise<Receipt | null> {
    const key = receiptKey(scope, id),
      row = await this.rooms.deps.store.get<Receipt>('remote_receipt', key)
    if (!row) return null
    return row.value.status === 'accepted' && !this.flights.has(key)
      ? { ...row.value, status: 'reconciliation_required' }
      : row.value
  }
  async recovered(
    scope: RemoteScope,
    id: string,
    result: unknown
  ): Promise<Receipt | null> {
    const key = receiptKey(scope, id)
    return this.rooms.exclusive(async () => {
      const row = await this.rooms.deps.store.get<Receipt>(
        'remote_receipt',
        key
      )
      if (!row) return null
      if (row.value.status === 'applied') return row.value
      const receipt: Receipt = { ...row.value, status: 'applied', result }
      await this.rooms.deps.store.commit({
        requestId: key + '-recover',
        checks: [
          { kind: 'remote_receipt', id: key, expectedRevision: row.revision }
        ],
        puts: [{ kind: 'remote_receipt', id: key, value: receipt }]
      })
      return receipt
    })
  }
  async execute(
    envelope: Envelope,
    run: () => Promise<unknown>
  ): Promise<Receipt> {
    const key = receiptKey(envelope, envelope.call.requestId)
    const fingerprint = createHash('sha256')
      .update(canonical({ method: envelope.call.method, params: envelope.call.params }))
      .digest('hex')
    const old = await this.rooms.deps.store.get<Receipt>('remote_receipt', key)
    if (old) {
      // Legacy receipts hashed the transport TTL too. Compare the persisted
      // original content when present; never ignore changed semantic params.
      const matches = old.value.params !== undefined
        ? old.value.method === envelope.call.method && canonical(old.value.params) === canonical(envelope.call.params)
        : old.value.fingerprint === createHash('sha256').update(canonical(envelope.call)).digest('hex')
      if (!matches) throw new Error('REQUEST_CONFLICT')
      return (
        this.flights.get(key) ?? {
          ...old.value,
          status:
            old.value.status === 'accepted'
              ? 'reconciliation_required'
              : old.value.status
        }
      )
    }
    if (
      envelope.call.expiresAt <= Date.now() ||
      envelope.call.expiresAt > Date.now() + 300000
    )
      throw new Error('REQUEST_EXPIRED')
    const current = this.flights.get(key)
    if (current) return current.then((receipt) => {
      if (receipt.fingerprint !== fingerprint) throw new Error('REQUEST_CONFLICT')
      return receipt
    })
    const operation = (async () => {
      const receipt: Receipt = {
        requestId: envelope.call.requestId,
        method: envelope.call.method,
        params: envelope.call.params,
        fingerprint,
        status: 'accepted',
        createdAt: Date.now()
      }
      await this.rooms.exclusive(() =>
        this.rooms.deps.store.commit({
          requestId: key + '-accept',
          fingerprint,
          checks: [{ kind: 'remote_receipt', id: key, expectedRevision: null }],
          puts: [{ kind: 'remote_receipt', id: key, value: receipt }]
        })
      )
      let result: unknown
      try {
        result = await run()
      } catch (error) {
        // Never infer that a thrown/timeout mutation had no effect.
        receipt.status = 'reconciliation_required'
        if (error instanceof RemoteNoEffect)
          receipt.error = { code: error.code, definitive: true }
      }
      if (receipt.status === 'accepted') {
        receipt.status = 'applied'
        receipt.result = result
      }
      await this.rooms.exclusive(async () => {
        const row = await this.rooms.deps.store.get('remote_receipt', key)
        await this.rooms.deps.store.commit({
          requestId: key + '-settle',
          checks: [
            { kind: 'remote_receipt', id: key, expectedRevision: row!.revision }
          ],
          puts: [{ kind: 'remote_receipt', id: key, value: receipt }]
        })
      })
      return receipt
    })()
    this.flights.set(key, operation)
    try {
      return await operation
    } finally {
      this.flights.delete(key)
    }
  }
}
