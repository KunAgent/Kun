import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THREAD_ROW_READABLE_TTL_MS, ThreadRowReadability } from './hybrid-thread-row-readability.js'
import type { ThreadRow } from './hybrid-thread-index-mapping.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-row-readability-')); roots.push(root)
  const paths = {
    threadDir: (id: string) => join(root, id),
    metadataPath: (id: string) => join(root, id, 'thread.jsonl'),
    legacyThreadPath: (id: string) => join(root, id, 'thread.json'),
    messagesPath: (id: string) => join(root, id, 'messages.jsonl'),
    eventsPath: (id: string) => join(root, id, 'events.jsonl')
  }
  let clock = 1_000
  const repair = vi.fn()
  const readability = new ThreadRowReadability(paths, repair, () => clock)
  const id = 'thr_0123456789abcdef0123456789abcdef'
  await mkdir(paths.threadDir(id), { recursive: true })
  await writeFile(paths.metadataPath(id), '{}\n')
  const row = { id, metadata_path: paths.metadataPath(id), messages_path: paths.messagesPath(id), events_path: paths.eventsPath(id) } as ThreadRow
  return { root, paths, readability, row, repair, advance: (ms: number) => { clock += ms } }
}

describe('thread row readability memo', () => {
  it('trusts a verified row within the TTL and rechecks after it or after forget', async () => {
    const f = await fixture()
    expect(await f.readability.check(f.row)).toBe(true)
    await rm(f.paths.threadDir(f.row.id), { recursive: true, force: true })
    expect(await f.readability.check(f.row)).toBe(true)
    f.advance(THREAD_ROW_READABLE_TTL_MS)
    expect(await f.readability.check(f.row)).toBe(false)
  })

  it('forgets a deleted row immediately and repairs stale cached paths without memoizing', async () => {
    const f = await fixture()
    expect(await f.readability.check(f.row)).toBe(true)
    f.readability.forget(f.row.id)
    await rm(f.paths.threadDir(f.row.id), { recursive: true, force: true })
    expect(await f.readability.check(f.row)).toBe(false)
    await mkdir(f.paths.threadDir(f.row.id), { recursive: true })
    await writeFile(f.paths.metadataPath(f.row.id), '{}\n')
    const moved = { ...f.row, metadata_path: '/old/root/thread.jsonl' } as ThreadRow
    expect(await f.readability.check(moved)).toBe(true)
    expect(f.repair).toHaveBeenCalledWith(f.row.id)
  })
})
