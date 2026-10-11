import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SqliteRoomStore } from './room-store-sqlite.js'

const resources: Array<{ root: string; store: SqliteRoomStore }> = []
afterEach(async () => {
  for (const { root, store } of resources.splice(0)) { await store.close(); await rm(root, { recursive: true, force: true }) }
})
it('erases derived memory receipt bytes while retaining conversation archives and replay fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'room-memory-erase-')), path = join(root, 'rooms.sqlite')
  const store = new SqliteRoomStore({ path }); resources.push({ root, store })
  const secret = 'UNIQUE_DERIVED_MEMORY_ERASURE_BYTES_7fe8'
  await store.commit({ requestId: 'create-memory', fingerprint: 'a'.repeat(64),
    checks: [{ kind: 'agent_memory_job', id: 'memory-job', expectedRevision: null }],
    puts: [{ kind: 'agent_memory_job', id: 'memory-job', roomId: 'room-a', value: {
      id: 'memory-job', phase: 'candidate', status: 'completed', memoryId: 'mem_erased',
      candidate: { content: secret }, snapshot: { input: secret } } }],
    result: { memory: { id: 'mem_erased', content: secret, history: [{ snapshot: { content: secret } }] } } })
  await store.commit({ requestId: 'conversation-archive', checks: [{ kind: 'message', id: 'archive-message', expectedRevision: null }], puts: [{ kind: 'message', id: 'archive-message', roomId: 'room-a', value: {
    id: 'archive-message', body: 'User conversation must survive', status: 'final' } }] })
  expect((await store.scrubMemoryData({ memoryIds: ['mem_erased'] })).scrubbed).toBeGreaterThan(0)
  expect(await store.getRequest('create-memory')).toMatchObject({ fingerprint: 'a'.repeat(64), result: { erased: true } })
  expect(JSON.stringify((await store.get('agent_memory_job', 'memory-job'))?.value)).not.toContain(secret)
  expect((await store.get<{ body: string }>('message', 'archive-message'))?.value.body).toBe('User conversation must survive')
  expect((await readFile(path)).includes(Buffer.from(secret))).toBe(false)
  expect((await store.scrubMemoryData({ memoryIds: ['mem_erased'] })).scrubbed).toBeGreaterThanOrEqual(0)
})
