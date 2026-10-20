import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import { MemoryRelationCommand, MemoryRelationModelOutput, MemoryRelationProposal } from '../contracts/memory-relations.js'
import { FileMemoryStore } from './memory-store.js'
import { relationBinding, sameRelationScope } from './memory-relations.js'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'kun-relations-'))
  directories.push(rootDir)
  const options = { rootDir, config: MemoryCapabilityConfig.parse({ enabled: true }) }
  const store = new FileMemoryStore(options)
  const source = await store.createWithId('mem_new', { content: 'Use PostgreSQL 17 for the database.', scope: 'user' })
  const target = await store.createWithId('mem_old', { content: 'Use PostgreSQL 16 for the database.', scope: 'user' })
  const proposal = {
    source: relationBinding(source), target: relationBinding(target), kind: 'contradicts' as const,
    sourceEvidence: { start: 4, end: 17 }, targetEvidence: { start: 4, end: 17 }
  }
  const propose = () => store.relations({ action: 'propose', proposals: [proposal], access: {} })
  return { rootDir, options, store, source, target, proposal, propose }
}

describe('Memory relation contracts', () => {
  it('rejects privileges, self edges, replacement types, and unbounded/empty evidence', async () => {
    const { proposal } = await fixture()
    expect(MemoryRelationCommand.safeParse({ action: 'list', memoryId: 'mem_new', access: { all: true } }).success).toBe(false)
    for (const patch of [
      { target: proposal.source }, { kind: 'supersedes' }, { sourceEvidence: { start: 0, end: 513 } },
      { targetEvidence: { start: 2, end: 2 } }, { rationale: 'extra payload' }
    ]) expect(MemoryRelationProposal.safeParse({ ...proposal, ...patch }).success).toBe(false)
    expect(MemoryRelationModelOutput.safeParse({ relations: [{
      targetId: '../secret', kind: 'confirms', sourceQuote: 'x', targetQuote: 'x'
    }] }).success).toBe(false)
  })
})

describe('Memory relation storage', () => {
  it('persists content-free evidence and idempotent decisions across restart without changing records or ranking', async () => {
    const f = await fixture()
    const before = await f.store.retrieve({ query: 'PostgreSQL database', limit: 8 })
    const [{ suggestion }] = (await f.propose()).relations
    const accepted = await f.store.relations({ action: 'review', id: suggestion.id, decision: 'accepted', access: {} })
    const restarted = new FileMemoryStore(f.options)
    expect(await restarted.relations({ action: 'review', id: suggestion.id, decision: 'accepted', access: {} })).toEqual(accepted)
    expect((await f.propose()).relations[0].suggestion.status).toBe('accepted')
    await expect(restarted.relations({ action: 'review', id: suggestion.id, decision: 'rejected', access: {} })).rejects.toThrow(/stale/)
    expect(await restarted.getById(f.source.id)).toEqual(f.source)
    expect(await restarted.getById(f.target.id)).toEqual(f.target)
    expect(Object.keys(accepted.relations[0].source).sort()).toEqual(['content', 'id', 'revision', 'scope', 'sources'])
    expect((await restarted.retrieve({ query: 'PostgreSQL database', limit: 8 })).map((x) => x.id)).toEqual(before.map((x) => x.id))
    const ledger = await readFile(join(f.rootDir, 'relations/suggestions.json'), 'utf8')
    expect(ledger).not.toContain('PostgreSQL')
    expect(ledger).not.toContain(f.source.content)
  })

  it('does not overwrite a rejection with a new model label', async () => {
    const f = await fixture()
    const id = (await f.propose()).relations[0].suggestion.id
    await f.store.relations({ action: 'review', id, decision: 'rejected', access: {} })
    const next = await f.store.relations({ action: 'propose', proposals: [{ ...f.proposal, kind: 'extends' }], access: {} })
    expect(next.relations[0].suggestion).toMatchObject({ id, status: 'rejected', proposal: { kind: 'contradicts' } })
  })

  it('invalidates stale proposals and accepted evidence after an edit and rollback', async () => {
    const f = await fixture()
    const id = (await f.propose()).relations[0].suggestion.id
    await f.store.relations({ action: 'review', id, decision: 'accepted', access: {} })
    const changed = await f.store.update(f.target.id, { content: 'Use SQLite.', expectedRevision: f.target.revision })
    await f.store.lifecycle(f.target.id, { action: 'rollback', expectedRevision: changed.revision, targetRevision: 1 })
    const stale = (await f.store.relations({ action: 'list', memoryId: f.source.id, access: {} })).relations[0]
    expect(stale.stale).toBe(true)
    expect(stale.source.content).toBe('')
    expect(stale.target.sources).toEqual([])
    await expect(f.propose()).rejects.toThrow(/stale/)
    await expect(f.store.relations({ action: 'review', id, decision: 'accepted', access: {} })).rejects.toThrow(/stale/)
  })

  it('serializes competing decisions so only one wins', async () => {
    const f = await fixture()
    const id = (await f.propose()).relations[0].suggestion.id
    const results = await Promise.allSettled(['accepted', 'rejected'].map((decision) =>
      f.store.relations({ action: 'review', id, decision: decision as 'accepted' | 'rejected', access: {} })))
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('requires matching canonical project ownership, not just a shared label', async () => {
    const f = await fixture()
    const source = { ...f.source, scope: 'project' as const, project: '/checkout/a', projectIdentity: '/repo/a/.git' }
    const worktree = { ...f.target, scope: 'project' as const, project: '/checkout/b', projectIdentity: '/repo/a/.git' }
    expect(sameRelationScope(source, worktree)).toBe(true)
    expect(sameRelationScope(source, { ...worktree, projectIdentity: '/repo/b/.git' })).toBe(false)
    expect(sameRelationScope(source, { ...worktree, projectIdentity: undefined })).toBe(false)
  })

  it('blocks cross-scope, unauthorized, directive, inactive, and invalid-evidence endpoints atomically', async () => {
    const f = await fixture()
    const other = await f.store.createWithId('mem_workspace', { scope: 'workspace', workspace: '/secret-project', content: 'PostgreSQL' })
    await expect(f.store.relations({
      action: 'propose', access: { workspace: '/secret-project' },
      proposals: [{ ...f.proposal, target: relationBinding(other), targetEvidence: { start: 0, end: 5 } }]
    })).rejects.toThrow(/stale/)
    await expect(f.store.relations({ action: 'list', memoryId: other.id, access: {} })).rejects.toThrow()
    await expect(f.store.relations({
      action: 'propose', access: {}, proposals: [f.proposal, { ...f.proposal, targetEvidence: { start: 100, end: 110 } }]
    })).rejects.toThrow(/stale/)
    expect((await f.store.relations({ action: 'list', memoryId: f.source.id, access: {} })).relations).toEqual([])
    const directive = await f.store.update(f.target.id, { authority: 'directive' })
    await expect(f.store.relations({ action: 'propose', access: {},
      proposals: [{ ...f.proposal, target: relationBinding(directive) }] })).rejects.toThrow(/stale/)
    const inactive = await f.store.update(f.target.id, { authority: 'reference', disabled: true })
    await expect(f.store.relations({ action: 'propose', access: {},
      proposals: [{ ...f.proposal, target: relationBinding(inactive) }] })).rejects.toThrow(/stale/)
  })

  it.each(['forget', 'erase'] as const)('scrubs %s references including restart and blocks replay', async (action) => {
    const f = await fixture()
    await f.propose()
    await f.store.lifecycle(f.target.id, {
      action, expectedRevision: f.target.revision,
      ...(action === 'erase' ? { confirmation: { memoryId: f.target.id, irreversible: true as const } } : {})
    })
    expect(await readFile(join(f.rootDir, 'relations/suggestions.json'), 'utf8')).not.toContain(f.target.id)
    const restarted = new FileMemoryStore(f.options)
    expect((await restarted.relations({ action: 'list', memoryId: f.source.id, access: {} })).relations).toEqual([])
    await expect(f.propose()).rejects.toThrow()
  })

  it('never overwrites corrupt storage as if it were absent', async () => {
    const f = await fixture()
    await f.propose()
    const path = join(f.rootDir, 'relations/suggestions.json')
    await writeFile(path, '{invalid-private-payload')
    await expect(f.propose()).rejects.toThrow('Memory relation storage is unavailable')
    expect(await readFile(path, 'utf8')).toBe('{invalid-private-payload')
  })

  it('preserves decisions if an endpoint cannot be parsed instead of treating it as deleted', async () => {
    const f = await fixture()
    await f.propose()
    const path = join(f.rootDir, 'relations/suggestions.json')
    const before = await readFile(path, 'utf8')
    await writeFile(join(f.rootDir, f.target.id + '.json'), '{invalid-endpoint')
    await expect(f.store.relations({ action: 'list', memoryId: f.source.id, access: {} })).rejects.toThrow(/endpoint is unavailable/)
    expect(await readFile(path, 'utf8')).toBe(before)
  })
})
