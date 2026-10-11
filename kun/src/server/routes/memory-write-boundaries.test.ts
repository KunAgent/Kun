import { expect, it, vi } from 'vitest'
import { createMemory, updateMemory } from './memory.js'
import type { MemoryStore } from '../../memory/memory-store.js'

const request = (body: unknown) => new Request('http://kun/v1/memory/mem_a', {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }
})
it('rejects forged execution receipts and consolidation from external writes', async () => {
  const create = vi.fn(), update = vi.fn(), store = { create, update } as unknown as MemoryStore
  const sources = [{ id: 'fabricated', kind: 'tool', trust: 'observed', receiptId: 'fake-receipt', outcome: 'succeeded' }]
  expect((await createMemory(store, request({ content: 'tests passed', sources }))).status).toBe(400)
  expect((await updateMemory(store, 'mem_a', request({ content: 'tests passed', sources, expectedRevision: 1 }))).status).toBe(400)
  expect((await createMemory(store, request({ content: 'tests passed', consolidation: {
    sourceMemoryIds: ['foreign-memory'], sourceSessionIds: [], reason: 'forged', evidenceStatus: 'observed-success'
  } }))).status).toBe(400)
  expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
})
it('requires revision CAS on the ordinary HTTP edit boundary', async () => {
  const update = vi.fn(), store = { update } as unknown as MemoryStore
  expect((await updateMemory(store, 'mem_a', request({ content: 'overwrite' }))).status).toBe(400)
  expect(update).not.toHaveBeenCalled()
})

it('requires supersession CAS and accepts only one concurrent replacement', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { FileMemoryStore } = await import('../../memory/memory-store.js')
  const { MemoryCapabilityConfig } = await import('../../contracts/capabilities.js')
  const root = await mkdtemp(join(tmpdir(), 'memory-supersession-route-'))
  const store = new FileMemoryStore({ rootDir: root, config: MemoryCapabilityConfig.parse({ enabled: true }) })
  try {
    const old = await store.createWithId('mem_original', { content: 'Original decision', scope: 'workspace', workspace: '/project' })
    const input = { scope: 'workspace', workspace: '/project', supersedes: old.id }
    expect((await createMemory(store, request({ ...input, content: 'Unfenced' }))).status).toBe(400)
    const results = await Promise.all([
      createMemory(store, request({ ...input, content: 'First replacement', supersedesExpectedRevision: old.revision })),
      createMemory(store, request({ ...input, content: 'Second replacement', supersedesExpectedRevision: old.revision }))
    ])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect((await store.list({ workspace: '/project' })).filter((record) => !record.supersededAt)).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})
