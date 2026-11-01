import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileThreadStore } from './file/file-thread-store.js'
import { HybridThreadStore } from './hybrid/hybrid-thread-store.js'
import { InMemoryThreadStore } from './in-memory-thread-store.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { MAX_NATIVE_FOLLOWUP_RECEIPTS, NativeFollowUpRequestsSchema, type NativeFollowUpRequest } from '../contracts/native-followup-requests.js'
import { withNativeFollowUpRequest } from '../domain/native-followup-requests.js'
import { createThreadRecord } from '../domain/thread.js'

const roots: string[] = []
const closers: Array<() => void> = []
const now = '2026-11-02T01:00:00.000Z'
const id = 'thr_receipt_retention'
type StoreKind = 'memory' | 'file' | 'hybrid'

function receipt(index = 0): NativeFollowUpRequest {
  return {
    threadId: id,
    admission: { requestId: `request_${index}`, effectId: `effect_${index}`, attemptId: `attempt_${index}`,
      admissionKey: `permit_${index}`, fingerprint: 'a'.repeat(64) },
    requestFingerprint: 'b'.repeat(64), turnId: `turn_${index}`, userMessageItemId: `item_turn_${index}_user`,
    preparationRevision: 1, phase: 'admitted', terminalStatus: 'completed', createdAt: now, updatedAt: now
  }
}
function thread(row?: NativeFollowUpRequest): ThreadRecord {
  return {
    ...createThreadRecord({ id, title: 'Receipt retention', workspace: '/tmp/receipt-workspace', model: 'deepseek-v4-pro' }),
    createdAt: now, updatedAt: now,
    ...(row ? { nativeFollowUpRequests: [row] } : {})
  }
}
function open(kind: StoreKind, root: string): { store: ThreadStore; close: () => void } {
  const store = kind === 'memory' ? new InMemoryThreadStore()
    : kind === 'file' ? new FileThreadStore({ dataDir: root }) : new HybridThreadStore({ dataDir: root })
  let closed = false
  const close = () => { if (!closed && store instanceof HybridThreadStore) store.close(); closed = true }
  closers.push(close)
  return { store, close }
}
async function setup(kind: StoreKind) {
  const root = await mkdtemp(join(tmpdir(), 'kun-native-receipts-'))
  roots.push(root)
  return { root, ...open(kind, root) }
}
afterEach(async () => {
  for (const close of closers.splice(0)) close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

for (const kind of ['memory', 'file', 'hybrid'] as const) describe(`${kind} native receipt retention`, () => {
  it('keeps legacy records unchanged and does not synthesize receipt authority', async () => {
    const { store } = await setup(kind)
    const stored = await store.upsert(thread())
    expect(stored).not.toHaveProperty('nativeFollowUpRequests')
    expect(await store.get(id)).not.toHaveProperty('nativeFollowUpRequests')
    if (store instanceof HybridThreadStore) expect((store as unknown as { db: unknown }).db).toBeTruthy()
  })

  it('retains accepted tombstones through history omission, conditional writes and stale revisions', async () => {
    const { store } = await setup(kind)
    const stored = await store.upsert(thread(receipt()))
    const { nativeFollowUpRequests: _receipts, ...oldSnapshot } = thread()
    const edited = await store.upsert({ ...oldSnapshot, title: 'Restored old history' })
    expect(edited.nativeFollowUpRequests).toEqual(stored.nativeFollowUpRequests)
    const conditional = await store.upsertIfRevision!({ ...oldSnapshot, title: 'Conditional restore' }, edited.revision!)
    expect(conditional.applied).toBe(true)
    expect(await store.upsertIfRevision!({ ...oldSnapshot, title: 'Stale restore' }, edited.revision!)).toMatchObject({ applied: false })
    const metadata = store.getMetadata ? await store.getMetadata(id) : await store.get(id)
    expect(metadata?.nativeFollowUpRequests).toEqual([receipt()])
    expect(metadata?.title).toBe('Conditional restore')
  })

  it('never regresses an accepted terminal receipt to an earlier retryable snapshot', async () => {
    const { store } = await setup(kind)
    await store.upsert(thread(receipt()))
    const prior = { ...receipt(), phase: 'preparing' as const, terminalStatus: undefined,
      updatedAt: '2026-11-02T00:00:00.000Z' }
    const restored = await store.upsert({ ...thread(prior), updatedAt: prior.updatedAt })
    expect(restored.nativeFollowUpRequests).toEqual([receipt()])
  })

  it('does not restore old negative authority over a newer native preparation', async () => {
    const { store } = await setup(kind)
    const negative = { ...receipt(), phase: 'known_not_admitted' as const, terminalStatus: undefined }
    await store.upsert(thread(negative))
    const preparing = { ...negative, phase: 'preparing' as const, preparationRevision: 2 }
    await store.upsert(thread(preparing))
    await store.upsert(thread(negative))
    expect((await store.get(id))?.nativeFollowUpRequests).toEqual([preparing])
    await expect(store.upsert(thread({ ...preparing, preparationRevision: 4 }))).rejects.toThrow(/revision cannot skip/)
  })

  it('cannot reopen a verified rolled-back preparation without a new preparation revision', async () => {
    const { store } = await setup(kind)
    const negative = { ...receipt(), phase: 'known_not_admitted' as const, terminalStatus: undefined }
    await store.upsert(thread(negative))
    await expect(store.upsert(thread({ ...negative, phase: 'admitted' }))).rejects.toThrow(/rolled-back/)
    expect((await store.get(id))?.nativeFollowUpRequests).toEqual([negative])
  })

  it('rejects target, fingerprint, terminal-outcome and cross-thread identity replacement', async () => {
    const { store } = await setup(kind)
    await store.upsert(thread(receipt()))
    for (const patch of [
      { turnId: 'replacement_turn' }, { requestFingerprint: 'c'.repeat(64) },
      { admission: { ...receipt().admission, fingerprint: 'd'.repeat(64) } },
      { terminalStatus: 'cancelled' as const }, { threadId: 'another_thread' }
    ]) {
      await expect(store.upsert(thread({ ...receipt(), ...patch }))).rejects.toThrow(/native receipt|native follow-up/)
    }
    expect((await store.get(id))?.nativeFollowUpRequests).toEqual([receipt()])
  })
})

it.each(['file', 'hybrid'] as const)('retains receipts after a real %s store closes and reopens', async (kind) => {
  const { root, store, close } = await setup(kind)
  await store.upsert(thread(receipt()))
  close()
  const reopened = open(kind, root).store
  const metadata = reopened.getMetadata ? await reopened.getMetadata(id) : await reopened.get(id)
  expect(metadata?.nativeFollowUpRequests).toEqual([receipt()])
  expect((await reopened.get(id))?.nativeFollowUpRequests).toEqual([receipt()])
})

it('bounds native receipts without evicting identities to make room for a new request', () => {
  const rows = Array.from({ length: MAX_NATIVE_FOLLOWUP_RECEIPTS }, (_, index) => receipt(index))
  expect(NativeFollowUpRequestsSchema.parse(rows)).toHaveLength(MAX_NATIVE_FOLLOWUP_RECEIPTS)
  const full = { ...thread(), nativeFollowUpRequests: rows }
  const before = JSON.stringify(full)
  expect(() => withNativeFollowUpRequest(full, receipt(MAX_NATIVE_FOLLOWUP_RECEIPTS))).toThrow()
  expect(JSON.stringify(full)).toBe(before)
  expect(withNativeFollowUpRequest(full, { ...rows[0]!, updatedAt: '2026-11-02T02:00:00.000Z' }).nativeFollowUpRequests)
    .toHaveLength(MAX_NATIVE_FOLLOWUP_RECEIPTS)
})
