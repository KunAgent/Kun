import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AssistantTaskStore } from './task-store'
const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })
async function location() { const dir = await mkdtemp(join(tmpdir(), 'kun-assistant-recovery-')); dirs.push(dir); return join(dir, 'tasks.json') }
it('retains older working tasks and supports history pagination and direct task lookup', async () => {
  const path = await location(), at = new Date().toISOString(), ids = Array.from({ length: 201 }, () => randomUUID())
  const tasks = ids.slice(0, 200).map(id => ({ id, assistantId: 'a', assistantName: 'A', title: id, body: 'working', createdAt: at, updatedAt: at, status: 'working', updates: [] }))
  await writeFile(path, JSON.stringify({ version: 1, tasks, notes: [], seen: [] }))
  const store = new AssistantTaskStore(path)
  await store.addTask({ id: ids[200], assistantId: 'a', assistantName: 'A', title: 'new', body: 'new', createdAt: at })
  expect((await store.task(ids[0]))?.status).toBe('working')
  expect((await store.findTask(ids[0].slice(0, 8)))?.id).toBe(ids[0])
  let cursor: string | undefined, collected: string[] = []
  do { const page = await store.history('a', cursor, 50); collected.push(...page.tasks.map(t => t.id)); cursor = page.nextCursor } while (cursor)
  expect(new Set(collected).size).toBe(201)
  expect(JSON.parse(await readFile(path, 'utf8')).tasks).toHaveLength(201)
})
it('late progress never reopens a completed task and corrupt versions never replace history', async () => {
  const path = await location(), store = new AssistantTaskStore(path), id = randomUUID(), at = new Date().toISOString()
  await store.addTask({ id, assistantId: 'a', assistantName: 'A', title: '', body: '', createdAt: at })
  const event = { id: randomUUID(), kind: 'reply' as const, inReplyTo: id, body: '', createdAt: at, status: 'done' as const }
  await store.applyIncoming({ id: 'a', name: 'A' }, event)
  await store.applyIncoming({ id: 'a', name: 'A' }, { ...event, id: randomUUID(), status: 'working' })
  await store.markCancelled(id)
  expect((await store.task(id))?.status).toBe('done')
  const bad = '{"version":999,"tasks":["must survive"]}'
  await writeFile(path, bad)
  await expect(new AssistantTaskStore(path).view(new Map())).rejects.toThrow('ASSISTANT_STORE_UNSUPPORTED')
  expect(await readFile(path, 'utf8')).toBe(bad)
})
