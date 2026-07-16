import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExpertStatusStore } from './expert-status-store.js'

let dir: string
let store: ExpertStatusStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'expert-status-'))
  store = new ExpertStatusStore(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ExpertStatusStore', () => {
  it('returns revision 0 with empty entries when status file missing', async () => {
    const snapshot = await store.load()
    expect(snapshot.revision).toBe(0)
    expect(snapshot.entries.size).toBe(0)
  })

  it('persists and reloads status entries', async () => {
    const snapshot = await store.load()
    snapshot.entries.set('expert_arch', { enabled: false, updatedAt: '2026-07-14T10:00:00Z' })
    await store.save({ revision: 1, entries: snapshot.entries }, 0)

    const reloaded = await store.load()
    expect(reloaded.revision).toBe(1)
    expect(reloaded.entries.get('expert_arch')).toEqual({
      enabled: false,
      updatedAt: '2026-07-14T10:00:00Z'
    })
  })

  it('throws on revision conflict', async () => {
    const snapshot = await store.load()
    snapshot.entries.set('expert_1', { enabled: false, updatedAt: '2026-07-14T10:00:00Z' })
    await store.save({ revision: 1, entries: snapshot.entries }, 0)

    await expect(
      store.save({ revision: 2, entries: new Map() }, 0)
    ).rejects.toThrow(/Revision mismatch/)
  })

  it('allows CAS update when expected revision matches', async () => {
    const first = await store.load()
    first.entries.set('expert_1', { enabled: false, updatedAt: '2026-07-14T10:00:00Z' })
    await store.save({ revision: 1, entries: first.entries }, 0)

    const second = await store.load()
    second.entries.set('expert_2', { enabled: true, updatedAt: '2026-07-14T11:00:00Z' })
    await store.save({ revision: 2, entries: second.entries }, 1)

    const reloaded = await store.load()
    expect(reloaded.revision).toBe(2)
    expect(reloaded.entries.size).toBe(2)
  })
})
