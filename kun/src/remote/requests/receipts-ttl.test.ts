import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonical } from '@kun/remote-protocol'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { RemoteReceipts, receiptKey, type Receipt } from './receipts.js'
import { Envelope } from '../contracts.js'
describe('personal receipt content identity across transport TTL refresh', () => {
  it('reuses a new-format result across TTL changes, but keeps business expiry semantic', async () => {
    const f = await remoteFixture()
    try {
      const ledger = new RemoteReceipts(f.rooms), envelope = Envelope.parse(f.envelope('code.turn.start', { threadId: 'task', text: 'same', expiresAt: 123 }, 'stable'))
      let calls = 0
      const first = await ledger.execute(envelope, async () => ({ count: ++calls }))
      expect(await ledger.execute({ ...envelope, call: { ...envelope.call, expiresAt: Date.now() + 120000 } }, async () => ++calls)).toEqual(first)
      await expect(ledger.execute({ ...envelope, call: { ...envelope.call, params: { ...envelope.call.params, expiresAt: 124 } } }, async () => ++calls)).rejects.toThrow('REQUEST_CONFLICT')
      expect(calls).toBe(1)
    } finally { await f.close() }
  })
  it('uses persisted original method/params to safely recognize legacy TTL-containing fingerprints', async () => {
    const f = await remoteFixture()
    try {
      const envelope = Envelope.parse(f.envelope('code.turn.start', { threadId: 'task', text: 'legacy' }, 'legacy'))
      const key = receiptKey(envelope, 'legacy'), old: Receipt = { requestId: 'legacy', method: envelope.call.method,
        params: envelope.call.params, fingerprint: createHash('sha256').update(canonical(envelope.call)).digest('hex'),
        status: 'applied', createdAt: Date.now(), result: { turnId: 'original' } }
      await f.store.commit({ requestId: 'seed', checks: [{ kind: 'remote_receipt', id: key, expectedRevision: null }], puts: [{ kind: 'remote_receipt', id: key, value: old }] })
      const ledger = new RemoteReceipts(f.rooms)
      expect(await ledger.execute({ ...envelope, call: { ...envelope.call, expiresAt: Date.now() + 120000 } }, async () => { throw Error('must not run') })).toEqual(old)
      await expect(ledger.execute({ ...envelope, call: { ...envelope.call, method: 'execution.stop' } }, async () => {})).rejects.toThrow('REQUEST_CONFLICT')
      await expect(ledger.execute({ ...envelope, call: { ...envelope.call, params: { text: 'changed' } } }, async () => {})).rejects.toThrow('REQUEST_CONFLICT')
    } finally { await f.close() }
  })
})
