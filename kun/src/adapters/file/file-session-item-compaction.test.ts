import { appendFile, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { makeAssistantTextItem } from '../../domain/item.js'
import { compactFileSessionItems } from './file-session-item-compaction.js'
import * as jsonl from './file-session-jsonl.js'
import { serializeItemRecords, serializeLiveItems } from './file-session-live-items.js'
import { JsonlFileAccessCoordinator } from './jsonl-file-access.js'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-clean-history-'))
  roots.push(root)
  const path = join(root, 'messages.jsonl')
  const item = makeAssistantTextItem({ id: 'a', threadId: 'thread', turnId: 'turn', text: 'original', status: 'completed' })
  if (item.kind !== 'assistant_text') throw new Error('Expected assistant text fixture')
  await writeFile(path, serializeItemRecords([item]))
  let revision = 0
  const input = {
    path, threadId: 'thread', evidencePath: join(root, 'tail.json'), liveItemsPath: join(root, 'live.json'),
    force: false, minimumBytes: 1,
    cachedItemCount: () => 0, fileAccess: new JsonlFileAccessCoordinator(), readRevision: () => revision,
    bumpRevision: () => { revision++ }, bumpItemsVersion: vi.fn(), cacheItems: vi.fn(),
    refreshIndex: vi.fn(async () => {}), scheduleRetry: vi.fn(),
    withThreadWrite: async <T>(operation: () => Promise<T>) => operation()
  }
  const realRead = jsonl.readLatestItemsFromJsonl
  const read = vi.spyOn(jsonl, 'readLatestItemsFromJsonl')
  return { input, item, read, realRead, run: () => compactFileSessionItems(input) }
}

it('does not rescan a clean unchanged history, but force and revision changes rescan', async () => {
  const { input, read, run } = await fixture()
  expect(await run()).toMatchObject({ compacted: false, itemCount: 1 })
  expect(await run()).toMatchObject({ compacted: false, itemCount: 1 })
  expect(read).toHaveBeenCalledTimes(1)
  await compactFileSessionItems({ ...input, force: true })
  expect(read).toHaveBeenCalledTimes(2)
  input.bumpRevision()
  await run()
  expect(read).toHaveBeenCalledTimes(3)
})

it('invalidates on append, same-size changes and replacement, without losing duplicate compaction', async () => {
  const { input, item, read, run } = await fixture()
  await run()
  await appendFile(input.path, serializeItemRecords([{ ...item, text: 'modified' }]))
  expect(await run()).toMatchObject({ compacted: true, itemCount: 1 })
  expect((await readFile(input.path, 'utf8')).includes('modified')).toBe(true)
  await run()
  const old = await stat(input.path)
  await writeFile(input.path, serializeItemRecords([{ ...item, text: 'replaced' }]))
  await utimes(input.path, old.atime, new Date(old.mtimeMs + 2000))
  await run()
  const count = read.mock.calls.length
  const replacement = input.path + '.new'
  await writeFile(replacement, await readFile(input.path))
  await utimes(replacement, old.atime, new Date(old.mtimeMs + 2000))
  await rename(replacement, input.path)
  await run()
  expect(read).toHaveBeenCalledTimes(count + 1)
  expect(await jsonl.readLatestItemsFromJsonl(input.path)).toMatchObject({ items: [{ text: 'replaced' }] })
})

it('does not memoize a scan when a concurrent append changes the source', async () => {
  const { input, item, read, realRead, run } = await fixture()
  read.mockImplementationOnce(async (...args) => {
    const parsed = await realRead(...args)
    await appendFile(input.path, serializeItemRecords([{ ...item, id: 'new' }]))
    input.bumpRevision()
    return parsed
  })
  await run()
  expect(await run()).toMatchObject({ itemCount: 2 })
  expect(read).toHaveBeenCalledTimes(2)
  await run()
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not memoize a failed scan or share revision hints across owners', async () => {
  const { input, read, run } = await fixture()
  read.mockRejectedValueOnce(new Error('read failed'))
  await expect(run()).rejects.toThrow('read failed')
  await run()
  await compactFileSessionItems({ ...input, fileAccess: new JsonlFileAccessCoordinator() })
  expect(read).toHaveBeenCalledTimes(3)
})

it('detects a same-size in-place replacement even when its mtime is restored', async () => {
  const { input, item, read, run } = await fixture()
  const fixedTime = new Date('2026-01-01T00:00:00Z')
  await utimes(input.path, fixedTime, fixedTime)
  await run()
  const before = await stat(input.path)
  await new Promise(resolve => setTimeout(resolve, 10))
  await writeFile(input.path, serializeItemRecords([{ ...item, text: 'replaced' }]))
  await utimes(input.path, fixedTime, fixedTime)
  const after = await stat(input.path)
  expect(after.size).toBe(before.size)
  expect(after.ino).toBe(before.ino)
  expect(after.mtimeMs).toBe(before.mtimeMs)
  expect(after.ctimeMs).not.toBe(before.ctimeMs)
  await run()
  expect(read).toHaveBeenCalledTimes(2)
})

it('bounds clean-history hints and rechecks an evicted history', async () => {
  const { input, item, read, run } = await fixture()
  await run()
  for (let index = 0; index < 128; index++) {
    const path = input.path + '.' + index
    await writeFile(path, serializeItemRecords([item]))
    await compactFileSessionItems({ ...input, path })
  }
  expect(read).toHaveBeenCalledTimes(129)
  await run()
  expect(read).toHaveBeenCalledTimes(130)
})


it('preserves the live overlay and durable prefix when a forced scan cannot shrink history', async () => {
  const { input, item } = await fixture()
  const live = { ...item, id: 'live', text: 'streaming', status: 'running' as const }
  await writeFile(input.liveItemsPath, serializeLiveItems([{ item: live, representedSeq: 1 }]))
  expect(await compactFileSessionItems({ ...input, force: true })).toMatchObject({ compacted: false, itemCount: 1 })
  expect(input.cacheItems).toHaveBeenCalledWith([item, live], 1)
  expect(await readFile(input.path, 'utf8')).toBe(serializeItemRecords([item]))
})
