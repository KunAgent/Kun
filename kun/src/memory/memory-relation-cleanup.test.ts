import * as files from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryErasureIncompleteError } from './memory-erasure-error.js'
import { FileMemoryStore } from './memory-store.js'
import { relationBinding } from './memory-relations.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, stat: vi.fn(actual.stat) }
})

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => files.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const rootDir = await files.mkdtemp(join(tmpdir(), 'kun-relation-cleanup-'))
  roots.push(rootDir)
  const options = { rootDir, config: MemoryCapabilityConfig.parse({ enabled: true }) }
  const store = new FileMemoryStore(options)
  const source = await store.createWithId('mem_source', { content: 'Database version 17.', scope: 'user' })
  const target = await store.createWithId('mem_target', { content: 'Database version 16.', scope: 'user' })
  const proposal = { source: relationBinding(source), target: relationBinding(target), kind: 'contradicts' as const,
    sourceEvidence: { start: 0, end: 8 }, targetEvidence: { start: 0, end: 8 } }
  const id = (await store.relations({ action: 'propose', access: {}, proposals: [proposal] })).relations[0].suggestion.id
  const path = join(rootDir, 'relations/suggestions.json')
  const original = await files.readFile(path, 'utf8')
  return { rootDir, options, store, source, target, proposal, id, path, original }
}

describe('relation cleanup fault isolation', () => {
  it.each(['malformed', 'oversized', 'unreadable'])('erases unrelated content despite a %s ledger and retries cleanup', async (fault) => {
    const f = await fixture()
    const record = await f.store.createWithId('mem_unrelated', { content: 'Unrelated synthetic private fact.', scope: 'user' })
    const request = { action: 'erase' as const, expectedRevision: record.revision,
      confirmation: { memoryId: record.id, irreversible: true as const } }
    const damaged = fault === 'malformed' ? '{invalid' : fault === 'oversized' ? ' '.repeat(2_000_001) : f.original
    await files.writeFile(f.path, damaged)
    if (fault === 'unreadable') vi.mocked(files.stat).mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(f.store.lifecycle(record.id, request)).rejects.toBeInstanceOf(MemoryErasureIncompleteError)
    await expect(files.readFile(join(f.rootDir, `${record.id}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await f.store.isForgotten({ content: record.content, scope: 'user' }, record.id)).toBe(true)
    expect(await files.readFile(f.path, 'utf8')).toBe(damaged)
    vi.restoreAllMocks()
    await files.writeFile(f.path, f.original)
    const restarted = new FileMemoryStore(f.options)
    await expect(restarted.lifecycle(record.id, request)).resolves.toMatchObject({ erased: true, affectedIds: [record.id] })
    expect(await files.readFile(f.path, 'utf8')).toBe(f.original)
  })

  it('removes canonical descendants before a failed ledger cleanup and scrubs references on retry', async () => {
    const f = await fixture()
    const child = await f.store.createWithId('mem_child', { content: 'Replacement synthetic fact.', scope: 'user', supersedes: f.target.id })
    const target = await f.store.getById(f.target.id)
    const request = { action: 'erase' as const, expectedRevision: target.revision,
      confirmation: { memoryId: target.id, irreversible: true as const } }
    await files.writeFile(f.path, '{invalid')
    await expect(f.store.lifecycle(target.id, request)).rejects.toThrow('incomplete')
    for (const id of [target.id, child.id]) {
      await expect(files.readFile(join(f.rootDir, `${id}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await files.writeFile(f.path, f.original)
    await expect(new FileMemoryStore(f.options).lifecycle(target.id, request)).resolves.toMatchObject({ erased: true })
    expect(JSON.parse(await files.readFile(f.path, 'utf8')).suggestions).toEqual([])
  })

  it('commits a forgetting tombstone before reporting incomplete relation cleanup', async () => {
    const f = await fixture()
    await files.writeFile(f.path, '{invalid')
    await expect(f.store.delete(f.target.id)).rejects.toThrow('incomplete')
    expect(JSON.parse(await files.readFile(join(f.rootDir, `${f.target.id}.json`), 'utf8')).deletedAt).toBeTruthy()
    await files.writeFile(f.path, f.original)
    await f.store.delete(f.target.id)
    expect(JSON.parse(await files.readFile(f.path, 'utf8')).suggestions).toEqual([])
  })

  it('does not read unrelated endpoints when listing, reviewing or proposing a clean relation', async () => {
    const f = await fixture()
    const a = await f.store.createWithId('mem_other_a', { content: 'Other setting A.', scope: 'user' })
    const b = await f.store.createWithId('mem_other_b', { content: 'Other setting B.', scope: 'user' })
    await f.store.relations({ action: 'propose', access: {}, proposals: [{ ...f.proposal,
      source: relationBinding(a), target: relationBinding(b) }] })
    await files.writeFile(join(f.rootDir, `${b.id}.json`), '{invalid endpoint')
    expect((await f.store.relations({ action: 'list', memoryId: f.source.id, access: {} })).relations).toHaveLength(1)
    await expect(f.store.relations({ action: 'review', id: f.id, decision: 'accepted', access: {} })).resolves.toBeDefined()
    await expect(f.store.relations({ action: 'propose', proposals: [f.proposal], access: {} })).resolves.toBeDefined()
    await expect(f.store.relations({ action: 'withdraw', id: f.id, access: {} })).resolves.toBeDefined()
    expect(JSON.parse(await files.readFile(f.path, 'utf8')).suggestions).toHaveLength(2)
    await expect(f.store.relations({ action: 'list', memoryId: a.id, access: {} })).rejects.toThrow('endpoint is unavailable')
  })
})
