import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NotificationReceipts } from './notification-receipts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function file() { const root = await mkdtemp(join(tmpdir(), 'notification-receipts-')); roots.push(root); return join(root, 'receipts.json') }

it('deduplicates concurrent renderer deliveries and retains the native receipt after restart', async () => {
  const path = await file(), receipts = new NotificationReceipts(path)
  const show = vi.fn(async () => ({ ok: true, shown: true } as const))
  const results = await Promise.all([receipts.deliver('room:message:1', show), receipts.deliver('room:message:1', show)])
  expect(show).toHaveBeenCalledOnce()
  expect(results[1]).toEqual({ ok: true, shown: false, reason: 'duplicate' })
  expect(await new NotificationReceipts(path).deliver('room:message:1', show)).toMatchObject({ reason: 'duplicate' })
  expect(show).toHaveBeenCalledOnce()
})

it('retries failed native deliveries but records intentional suppression', async () => {
  const path = await file(), receipts = new NotificationReceipts(path)
  const show = vi.fn().mockResolvedValueOnce({ ok: false, message: 'OS unavailable' })
    .mockResolvedValueOnce({ ok: true, shown: false, reason: 'disabled' })
  expect(await receipts.deliver('approval:1', show)).toEqual({ ok: false, message: 'OS unavailable' })
  expect(await receipts.deliver('approval:1', show)).toMatchObject({ reason: 'disabled' })
  expect(await new NotificationReceipts(path).deliver('approval:1', show)).toMatchObject({ reason: 'duplicate' })
  expect(show).toHaveBeenCalledTimes(2)
})
