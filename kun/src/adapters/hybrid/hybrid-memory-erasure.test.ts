import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { HybridMemoryStore } from './hybrid-memory-store.js'
import { MemoryCapabilityConfig } from '../../contracts/capabilities.js'
import { AgentMemoryOwnershipSchema } from '../../memory/agent-memory-scope.js'

const resources: Array<{ root: string; store: HybridMemoryStore }> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const { root, store } of resources.splice(0)) { await store.shutdown(); await rm(root, { recursive: true, force: true }) }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hybrid-erasure-'))
  let fail = false
  const store = new HybridMemoryStore({ dataDir: root, config: MemoryCapabilityConfig.parse({ enabled: true }),
    beforeIndexRemove: () => { if (fail) throw new Error('injected projection failure') } })
  resources.push({ root, store }); await store.ready()
  const memory = await store.createWithId('mem_erasure_bytes', { content: 'UNIQUE_ERASURE_INDEX_BYTES_7481', scope: 'user',
    agentContext: AgentMemoryOwnershipSchema.parse({ schemaVersion: 1, agentId: 'agent', sourceConversationId: 'room' }) })
  await store.waitForBackfill()
  const access = { agent: { agentId: 'agent', manage: true, operationId: 'erase-op' } }
  const request = { action: 'erase' as const, expectedRevision: memory.revision,
    confirmation: { memoryId: memory.id, irreversible: true as const } }
  return { root, store, memory, access, request, fail: (value: boolean) => { fail = value } }
}
it('keeps erasure pending across projection failure and retries all IDs from the durable receipt', async () => {
  const f = await fixture(); f.fail(true)
  await expect(f.store.lifecycle(f.memory.id, f.request, f.access)).rejects.toThrow('incomplete')
  await expect(f.store.getById(f.memory.id, f.access)).rejects.toThrow('not found')
  await expect(f.store.erasureReceipt('erase-op')).rejects.toThrow('incomplete')
  f.fail(false)
  expect(await f.store.erasureReceipt('erase-op')).toEqual([f.memory.id])
  expect((await readFile(join(f.root, 'memory-index.sqlite3'))).includes(Buffer.from(f.memory.content))).toBe(false)
  const wal = await readFile(join(f.root, 'memory-index.sqlite3-wal')).catch(() => Buffer.alloc(0))
  expect(wal.includes(Buffer.from(f.memory.content))).toBe(false)
})
it('does not report erasure complete for a busy WAL checkpoint', async () => {
  const f = await fixture()
  const db = (f.store as unknown as { db: Database }).db
  const pragma = db.pragma.bind(db)
  const spy = vi.spyOn(db, 'pragma').mockImplementation((source, options) =>
    source.startsWith('wal_checkpoint') ? [{ busy: 1, log: 4, checkpointed: 0 }] : pragma(source, options))
  await expect(f.store.lifecycle(f.memory.id, f.request, f.access)).rejects.toThrow('incomplete')
  spy.mockRestore()
  expect(await f.store.erasureReceipt('erase-op')).toEqual([f.memory.id])
  expect((await readFile(join(f.root, 'memory-index.sqlite3'))).includes(Buffer.from(f.memory.content))).toBe(false)
})

it('retries ordinary scoped erasure after canonical deletion and projection failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ordinary-erasure-'))
  let fail = false
  const store = new HybridMemoryStore({ dataDir: root, config: MemoryCapabilityConfig.parse({ enabled: true }),
    beforeIndexRemove: () => { if (fail) throw new Error('projection failed') } })
  resources.push({ root, store }); await store.ready()
  const memory = await store.createWithId('mem_ordinary_erase', { content: 'ordinary-private-erasure', scope: 'workspace', workspace: '/project' })
  const access = { workspace: '/project' }
  const request = { action: 'erase' as const, expectedRevision: memory.revision,
    confirmation: { memoryId: memory.id, irreversible: true as const } }
  fail = true
  await expect(store.lifecycle(memory.id, request, access)).rejects.toThrow('incomplete')
  fail = false
  await expect(store.lifecycle(memory.id, request, { workspace: '/other' })).rejects.toThrow('not found')
  await expect(store.lifecycle(memory.id, { ...request, expectedRevision: 9 }, access)).rejects.toThrow('not found')
  await expect(store.lifecycle(memory.id, request, access)).resolves.toMatchObject({ erased: true, affectedIds: [memory.id] })
  await expect(store.lifecycle(memory.id, request, access)).resolves.toMatchObject({ erased: true })
  expect((await readFile(join(root, 'memory-index.sqlite3'))).includes(Buffer.from(memory.content))).toBe(false)
})
