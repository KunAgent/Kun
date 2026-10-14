import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import type { RoomRuntime } from '../rooms/room-runtime.js'
import { RemoteReceipts, receiptKey } from './receipts.js'
import { Envelope } from './contracts.js'
const envelope = () =>
  Envelope.parse({
    accountId: 'account',
    deviceId: 'phone',
    authorizationId: 'connection',
    call: {
      method: 'code.turn.start',
      requestId: 'r1',
      expiresAt: Date.now() + 60000,
      params: { threadId: 'thread', text: 'hello' }
    }
  })
describe('remote durable receipts', () => {
  it('deduplicates a lost result across process restarts and rejects changed payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-remote-'))
    let store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
    const rooms = () =>
      ({
        deps: { store },
        exclusive: async (fn: () => unknown) => fn()
      }) as unknown as RoomRuntime
    try {
      let count = 0
      let ledger = new RemoteReceipts(rooms())
      const e = envelope()
      const results = await Promise.all([
        ledger.execute(e, async () => ({ run: ++count })),
        ledger.execute(e, async () => ({ run: ++count }))
      ])
      expect(count).toBe(1)
      expect(results[0]).toEqual(results[1])
      await store.close()
      store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
      ledger = new RemoteReceipts(rooms())
      expect(
        (await ledger.execute(e, async () => ({ run: ++count }))).status
      ).toBe('applied')
      expect(count).toBe(1)
      await expect(
        ledger.execute(
          { ...e, call: { ...e.call, params: { text: 'different' } } },
          async () => {}
        )
      ).rejects.toThrow('REQUEST_CONFLICT')
    } finally {
      await store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('uncertain side effects never reexecute and expired new requests never run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-remote-')),
      store = new SqliteRoomStore({ path: join(dir, 'rooms.sqlite') })
    try {
      const rooms = {
        deps: { store },
        exclusive: async (fn: () => unknown) => fn()
      } as unknown as RoomRuntime
      const ledger = new RemoteReceipts(rooms),
        e = envelope()
      let calls = 0
      const uncertain = await ledger.execute(e, async () => {
        calls++
        throw new Error('after side effect')
      })
      expect(uncertain.status).toBe('reconciliation_required')
      await ledger.execute(e, async () => calls++)
      expect(calls).toBe(1)
      await expect(
        ledger.execute(
          { ...e, call: { ...e.call, requestId: 'expired', expiresAt: 1 } },
          async () => calls++
        )
      ).rejects.toThrow('REQUEST_EXPIRED')
      expect(calls).toBe(1)
      expect(
        await ledger.get({ ...e, accountId: 'someone-else' }, e.call.requestId)
      ).toBeNull()
    } finally {
      await store.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
