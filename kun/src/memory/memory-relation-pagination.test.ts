import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryRelationCommand, MemoryRelationResult, type MemoryRelationSuggestion } from '../contracts/memory-relations.js'
import { FileMemoryStore } from './memory-store.js'
import { executeMemoryRelationCommand } from './memory-relation-store.js'
import { relationBinding, relationId } from './memory-relations.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function fixture(count = 205) {
  const rootDir = await mkdtemp(join(tmpdir(), 'kun-relation-pages-'))
  roots.push(rootDir)
  const store = new FileMemoryStore({ rootDir, config: MemoryCapabilityConfig.parse({ enabled: true, relationContextEnabled: true }) })
  const source = await store.createWithId('mem_source', { content: 'Database version 17.', scope: 'user' })
  const template = await store.createWithId('mem_target', { content: 'Database version 16.', scope: 'user' })
  const targets = Array.from({ length: count }, (_, i) => ({ ...template, id: `mem_target_${i}` }))
  const entries: MemoryRelationSuggestion[] = targets.map((target, i) => {
    const proposal = { source: relationBinding(source), target: relationBinding(target), kind: 'contradicts' as const,
      sourceEvidence: { start: 0, end: 19 }, targetEvidence: { start: 0, end: 19 } }
    return { id: relationId(proposal), proposal, generator: 'model-relations-v1', status: i === 0 ? 'accepted' : 'pending',
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), ...(i === 0 ? { decidedAt: source.createdAt } : {}) }
  })
  await Promise.all(targets.map((target) => writeFile(join(rootDir, target.id + '.json'), JSON.stringify(target))))
  const ledgerPath = join(rootDir, 'relations', 'suggestions.json')
  await mkdir(join(rootDir, 'relations'))
  const save = () => writeFile(ledgerPath, JSON.stringify({ version: 1, suggestions: entries }))
  await save()
  const list = (extra: Partial<Extract<MemoryRelationCommand, { action: 'list' }>> = {}) =>
    store.relations({ action: 'list', memoryId: source.id, access: {}, ...extra })
  return { rootDir, store, source, targets, entries, ledgerPath, save, list }
}

describe('bounded relation pagination', () => {
  it('reaches every relation beyond 200 and withdraws the oldest accepted projection', async () => {
    const f = await fixture()
    let result = await f.list()
    expect(result.relations).toHaveLength(200)
    expect(MemoryRelationResult.safeParse(result).success).toBe(true)
    const ids = result.relations.map((item) => item.suggestion.id)
    result = await f.list({ before: result.nextCursor })
    expect(result.relations).toHaveLength(5)
    expect(result.nextCursor).toBeUndefined()
    expect(new Set([...ids, ...result.relations.map((item) => item.suggestion.id)]).size).toBe(205)
    expect((await f.list({ status: 'accepted', limit: 20 })).relations.map((item) => item.suggestion.id)).toEqual([f.entries[0].id])
    const request = { selected: [f.source, f.targets[0]].map(({ id, revision, content }) => ({ id, revision, content })),
      access: {}, purpose: 'injection' as const, remainingCharacters: 1600 }
    expect((await f.store.relationContext(request)).annotations).toHaveLength(1)
    await f.store.relations({ action: 'withdraw', id: f.entries[0].id, access: {} })
    expect((await f.store.relationContext(request)).annotations).toEqual([])
    expect((await f.list({ status: 'accepted' })).relations).toEqual([])
  })

  it('uses a stable timestamp/id cursor even if its record is removed and a newer record is inserted', async () => {
    const f = await fixture(6)
    f.entries.forEach((entry) => { entry.createdAt = f.entries[0].createdAt })
    await f.save()
    const first = await f.list({ limit: 2 })
    const expected = (await f.list()).relations.slice(2).map((item) => item.suggestion.id)
    f.entries.splice(f.entries.findIndex((entry) => entry.id === first.nextCursor!.id), 1)
    f.entries.push({ ...f.entries[0], id: 'relation_' + 'f'.repeat(64), createdAt: '2026-10-21T00:00:00.000Z' })
    await f.save()
    expect((await f.list({ before: first.nextCursor })).relations.map((item) => item.suggestion.id)).toEqual(expected)
  })

  it('filters stale decisions from current accepted results and keeps them revocable', async () => {
    const f = await fixture(2)
    await f.store.update(f.targets[0].id, { content: 'Changed database evidence.' })
    expect((await f.list({ status: 'accepted' })).relations).toEqual([])
    const stale = await f.list({ status: 'stale' })
    expect(stale.relations.map((item) => item.suggestion.id)).toEqual([f.entries[0].id])
    expect(stale.relations[0].source.content).toBe('')
    await f.store.relations({ action: 'withdraw', id: f.entries[0].id, access: {} })
    expect((await f.list({ status: 'stale' })).relations[0].suggestion.status).toBe('rejected')
  })

  it('does not disclose hidden endpoints or cursors, and authorizes the requested memory first', async () => {
    const f = await fixture(4)
    const authorize = vi.fn(async (id: string) => {
      if (id !== f.source.id && id !== f.targets[0].id) throw new Error('hidden')
      return f.store.getById(id)
    })
    const result = await executeMemoryRelationCommand({ rootDir: f.rootDir, now: new Date().toISOString(), authorize,
      command: { action: 'list', memoryId: f.source.id, access: {}, limit: 1 } })
    expect(result.relations.map((item) => item.suggestion.id)).toEqual([f.entries[0].id])
    expect(result.nextCursor).toBeUndefined()
    expect(authorize.mock.calls[0]).toEqual([f.source.id, {}])
  })

  it('does not read endpoints on pages outside the requested window', async () => {
    const f = await fixture(5)
    await writeFile(join(f.rootDir, f.targets[0].id + '.json'), '{bad')
    const before = await readFile(f.ledgerPath, 'utf8')
    const first = await f.list({ limit: 2 })
    expect(first.relations).toHaveLength(2)
    await expect(f.list({ before: first.nextCursor })).rejects.toThrow('Memory relation endpoint is unavailable')
    expect(await readFile(f.ledgerPath, 'utf8')).toBe(before)
  })

  it('rejects unbounded, malformed or privileged pagination inputs', () => {
    for (const extra of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { status: 'unknown' },
      { before: { createdAt: 'yesterday', id: 'secret' } }, { before: { createdAt: '2026-01-01T00:00:00Z', id: 'relation_' + 'a'.repeat(64), all: true } }]) {
      expect(MemoryRelationCommand.safeParse({ action: 'list', memoryId: 'mem_source', access: {}, ...extra }).success).toBe(false)
    }
  })
})
