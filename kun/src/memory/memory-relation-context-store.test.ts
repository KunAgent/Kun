import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCapabilityConfig } from '../contracts/capabilities.js'
import type { MemoryRelationContextRequest } from '../contracts/memory-working-context.js'
import { FileMemoryStore } from './memory-store.js'
import { relationBinding } from './memory-relations.js'
import { projectMemoryRelations } from './memory-relation-store.js'
import { resolveMemoryTurnContext } from './memory-turn-context.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })))
})

async function fixture(scope: 'user' | 'workspace' = 'user') {
  const rootDir = await mkdtemp(join(tmpdir(), 'kun-relation-context-'))
  roots.push(rootDir)
  let config = MemoryCapabilityConfig.parse({ enabled: true, relationContextEnabled: true })
  let now = '2026-10-20T00:00:00.000Z'
  const store = new FileMemoryStore({ rootDir, config: () => config, nowIso: () => now })
  const source = await store.createWithId('mem_source', { content: 'Database version 17.', scope, workspace: rootDir })
  const target = await store.createWithId('mem_target', { content: 'Database version 16.', scope, workspace: rootDir })
  const access = { workspace: rootDir }
  const proposal = { source: relationBinding(source), target: relationBinding(target), kind: 'contradicts' as const,
    sourceEvidence: { start: 0, end: 19 }, targetEvidence: { start: 0, end: 19 } }
  const id = (await store.relations({ action: 'propose', proposals: [proposal], access })).relations[0].suggestion.id
  const request: MemoryRelationContextRequest = {
    selected: [source, target].map(({ id, revision, content }) => ({ id, revision, content })),
    access, remainingCharacters: 1600, purpose: 'injection'
  }
  const accept = () => store.relations({ action: 'review', id, decision: 'accepted', access })
  return { store, rootDir, source, target, id, proposal, access, request, accept,
    configure: (value: object) => { config = MemoryCapabilityConfig.parse(value) },
    advance: () => { now = '2026-10-22T00:00:00.000Z' } }
}

describe('current canonical relation projection', () => {
  it('uses only accepted pairs already selected and never mutates stored evidence', async () => {
    const f = await fixture()
    expect((await f.store.relationContext(f.request)).annotations).toEqual([])
    await f.accept()
    const before = await readFile(join(f.rootDir, 'relations/suggestions.json'), 'utf8')
    const projected = await f.store.relationContext(f.request)
    expect(projected.annotations).toHaveLength(1)
    expect(projected.annotations[0]).toMatchObject({ id: f.id, kind: 'contradicts', source: { id: f.source.id } })
    expect(projected.block).not.toContain('Database version')
    expect((await f.store.relationContext({ ...f.request, selected: [f.request.selected[0]] })).annotations).toEqual([])
    expect((await f.store.relationContext({ ...f.request, remainingCharacters: 0 })).omittedByBudget).toBe(1)
    expect(await readFile(join(f.rootDir, 'relations/suggestions.json'), 'utf8')).toBe(before)
  })

  it('defaults off, supports explicit preview, and respects the master Memory switch', async () => {
    const f = await fixture()
    await f.accept()
    f.configure({ enabled: true })
    expect((await f.store.relationContext(f.request)).state).toBe('disabled')
    expect(await f.store.relationContext({ ...f.request, purpose: 'preview' })).toMatchObject({
      automaticEnabled: false, state: 'ready', annotations: [expect.objectContaining({ id: f.id })]
    })
    f.configure({ enabled: false, relationContextEnabled: true })
    expect((await f.store.relationContext({ ...f.request, purpose: 'preview' })).state).toBe('disabled')
  })

  it('does not replace live retrieval diagnostics with preview activity', async () => {
    const f = await fixture()
    await f.store.retrieve({ query: 'database version', workspace: f.rootDir, limit: 8 })
    f.store.setLastInjected([f.source.id])
    const before = await f.store.diagnostics()
    await resolveMemoryTurnContext(f.store, { query: 'unrelated sample', workspace: f.rootDir, preview: true })
    expect(await f.store.diagnostics()).toEqual(before)
  })

  it('withdraws accepted decisions idempotently without allowing silent reacceptance', async () => {
    const f = await fixture()
    await expect(f.store.relations({ action: 'withdraw', id: f.id, access: f.access })).rejects.toThrow()
    await f.accept()
    await f.store.relations({ action: 'withdraw', id: f.id, access: f.access })
    await f.store.relations({ action: 'withdraw', id: f.id, access: f.access })
    expect((await f.store.relationContext(f.request)).annotations).toEqual([])
    expect((await f.store.relations({ action: 'propose', access: f.access, proposals: [f.proposal] }))
      .relations[0].suggestion.status).toBe('rejected')
    await expect(f.accept()).rejects.toThrow()
    expect(await f.store.getById(f.target.id)).toEqual(f.target)
  })

  it.each(['edit', 'disable', 'forget', 'erase', 'supersede', 'directive'] as const)(
    'omits %s endpoints even with an old selected snapshot', async (action) => {
      const f = await fixture()
      await f.accept()
      if (action === 'edit') await f.store.update(f.target.id, { content: 'Different evidence.' })
      if (action === 'disable') await f.store.update(f.target.id, { disabled: true })
      if (action === 'directive') await f.store.update(f.target.id, { authority: 'directive' })
      if (action === 'supersede') await f.store.create({ scope: 'user', content: 'Database version 18.', supersedes: f.target.id })
      if (action === 'forget' || action === 'erase') await f.store.lifecycle(f.target.id, {
        action, expectedRevision: 1, ...(action === 'erase' ? { confirmation: { memoryId: f.target.id, irreversible: true } } : {})
      })
      expect((await f.store.relationContext(f.request)).annotations).toEqual([])
    })

  it('rechecks time expiry without requiring a revision change', async () => {
    const f = await fixture()
    const target = await f.store.update(f.target.id, { expiresAt: '2026-10-21T00:00:00.000Z' })
    const id = (await f.store.relations({ action: 'propose', access: f.access, proposals: [{
      ...f.proposal, target: relationBinding(target)
    }] })).relations[0].suggestion.id
    await f.store.relations({ action: 'review', id, decision: 'accepted', access: f.access })
    const request = { ...f.request, selected: [f.request.selected[0], { id: target.id, revision: target.revision, content: target.content }] }
    expect((await f.store.relationContext(request)).annotations).toHaveLength(1)
    f.advance()
    expect((await f.store.relationContext(request)).annotations).toEqual([])
  })

  it('does not disclose hidden endpoints or claim evidence absent from truncated content', async () => {
    const f = await fixture('workspace')
    await f.accept()
    expect((await f.store.relationContext({ ...f.request, access: { workspace: join(f.rootDir, 'other') } })).annotations).toEqual([])
    expect((await f.store.relationContext({
      ...f.request, selected: f.request.selected.map((record) => ({ ...record, content: 'Database' }))
    })).annotations).toEqual([])
    expect((await f.store.relationContext({
      ...f.request, selected: f.request.selected.map((record) => ({ ...record, content: 'invented evidence' }))
    })).annotations).toEqual([])
  })

  it('checks fingerprints, not only revision counters, and preserves unreadable ledgers', async () => {
    const f = await fixture()
    await f.accept()
    await writeFile(join(f.rootDir, f.target.id + '.json'), JSON.stringify({ ...f.target, content: 'Database version 99.' }))
    expect((await f.store.relationContext(f.request)).annotations).toEqual([])
    const path = join(f.rootDir, 'relations/suggestions.json')
    await writeFile(path, '{secret=broken')
    await expect(f.store.relationContext(f.request)).rejects.toThrow('Memory relation storage is unavailable')
    expect(await readFile(path, 'utf8')).toBe('{secret=broken')
  })

  it('never resolves records outside selected eligible pairs', async () => {
    const f = await fixture()
    await f.accept()
    const authorize = vi.fn((id: string) => f.store.getById(id))
    await projectMemoryRelations({
      rootDir: f.rootDir, request: f.request, authorize, now: '2026-10-20T00:00:00.000Z',
      enabled: true, memoryEnabled: true
    })
    expect(authorize.mock.calls.map(([id]) => id).sort()).toEqual(['mem_source', 'mem_target'])
  })
})
