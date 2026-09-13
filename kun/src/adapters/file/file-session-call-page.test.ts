import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionStore } from '../../ports/session-store.js'
import { makeToolCallItem, makeToolResultItem, makeUserItem } from '../../domain/item.js'
import { InMemorySessionStore } from '../in-memory-session-store.js'
import { FileSessionStore } from './file-session-store.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture(kind: string) {
  const root = await mkdtemp(join(tmpdir(), 'kun-call-items-'))
  roots.push(root)
  const threadId = 'thread_call_page'
  let store: SessionStore = kind === 'memory' ? new InMemorySessionStore() : new FileSessionStore({ dataDir: root })
  await store.appendItem(threadId, makeUserItem({ id: 'input', threadId, turnId: 'turn-a', text: 'Original user request' }))
  await store.appendItem(threadId, makeToolCallItem({ id: 'target-call', threadId, turnId: 'turn-a', callId: 'target', toolName: 'bash', arguments: { command: 'test' } }))
  for (let index = 0; index < 30; index += 1) {
    await store.appendItem(threadId, makeToolCallItem({ id: 'other-' + index, threadId, turnId: 'turn-a', callId: 'different-' + index, toolName: 'read_file', arguments: { path: 'large-file' } }))
    await store.appendItem(threadId, makeToolResultItem({ id: 'foreign-' + index, threadId, turnId: 'turn-b', callId: 'target', toolName: 'bash', output: 'Other turn', status: 'completed' }))
  }
  await store.appendItem(threadId, makeToolResultItem({ id: 'target-result', threadId, turnId: 'turn-a', callId: 'target', toolName: 'bash', output: 'old result', status: 'running' }))
  await store.appendItem(threadId, makeToolResultItem({ id: 'target-result', threadId, turnId: 'turn-a', callId: 'target', toolName: 'bash', output: 'latest result', status: 'completed' }))
  const directory = join(root, 'threads', threadId)
  if (kind === 'scan' || kind === 'old-index') {
    if (kind === 'scan') {
      for (const file of await readdir(directory)) if (file.includes('index')) await rm(join(directory, file))
    } else {
      const path = join(directory, 'messages-index.jsonl')
      const rows = (await readFile(path, 'utf8')).trim().split('\n').map((line) => {
        const row = JSON.parse(line); delete row.callId; return JSON.stringify(row)
      })
      await writeFile(path, rows.join('\n') + '\n')
    }
    store = new FileSessionStore({ dataDir: root, itemHistoryCompactionMinBytes: 1 })
  }
  return { root, store, threadId, directory }
}

describe.each(['memory', 'indexed', 'scan', 'old-index'])('exact-call item pages (%s)', (kind) => {
  it('filters call and turn before page limits, excludes request anchors, and retains the latest result', async () => {
    const { store, threadId } = await fixture(kind)
    const options = { turnId: 'turn-a', callId: 'target', maxItems: 4, maxBytes: 4096 }
    const pair = await store.loadItemPage!(threadId, { ...options, anchorTurnId: 'turn-a' })
    expect(pair.items.map((item) => item.id)).toEqual(['target-call', 'target-result'])
    expect(pair.items[1]).toMatchObject({ output: 'latest result', status: 'completed' })
    expect(pair.hasMore).toBe(false)
    const newest = await store.loadItemPage!(threadId, { ...options, maxItems: 1 })
    expect(newest.items.map((item) => item.id)).toEqual(['target-result'])
    expect(newest.hasMore).toBe(true)
    const older = await store.loadItemPage!(threadId, { ...options, maxItems: 1, before: newest.nextCursor })
    expect(older.items.map((item) => item.id)).toEqual(['target-call'])
    expect(older.hasMore).toBe(false)
    expect((await store.loadItemPage!(threadId, { ...options, before: 'other-10' })).items.map((item) => item.id)).toEqual(['target-call', 'target-result'])
    expect((await store.loadItemPage!(threadId, { ...options, callId: 'missing' })).items).toEqual([])
  })

  it('requires an exact turn and applies the call filter to original content fragments too', async () => {
    const { store, threadId } = await fixture(kind)
    await expect(store.loadItemPage!(threadId, { callId: 'target', maxItems: 4, maxBytes: 4096 })).rejects.toThrow('exact turn')
    const base = { turnId: 'turn-a', callId: 'target', itemId: 'target-result', maxItems: 1, maxBytes: 4096 }
    expect((await store.loadItemPage!(threadId, base)).content).toMatchObject({ field: 'output', text: 'latest result' })
    expect((await store.loadItemPage!(threadId, { ...base, callId: 'different' })).content).toBeUndefined()
    expect((await store.loadItemPage!(threadId, { ...base, turnId: 'turn-b' })).content).toBeUndefined()
    expect((await store.loadItemPage!(threadId, { ...base, itemId: 'input' })).content).toBeUndefined()
  })
})

it.each(['scan', 'old-index'])('keeps %s history and index files byte-for-byte unchanged during call inspection', async (kind) => {
  const { store, threadId, directory } = await fixture(kind)
  const before = new Map(await Promise.all((await readdir(directory)).map(async (name) => [name, {
    data: await readFile(join(directory, name)), modified: (await stat(join(directory, name))).mtimeMs
  }] as const)))
  const result = await store.loadItemPage!(threadId, { turnId: 'turn-a', callId: 'target', maxItems: 4, maxBytes: 4096 })
  expect(result.items.map((item) => item.id)).toEqual(['target-call', 'target-result'])
  await new Promise((resolve) => setTimeout(resolve, 25))
  expect(await readdir(directory)).toEqual([...before.keys()])
  for (const [name, saved] of before) {
    expect(await readFile(join(directory, name))).toEqual(saved.data)
    expect((await stat(join(directory, name))).mtimeMs).toBe(saved.modified)
  }
})
