import { describe, expect, it, vi } from 'vitest'
import { InMemorySessionStore } from '../adapters/in-memory-session-store.js'
import { makeUserItem } from '../domain/item.js'
import { referenceUnchangedItems, rewriteSessionHistory } from './session-history-rewrite.js'

async function fixture() {
  const store = new InMemorySessionStore()
  const first = makeUserItem({ id: 'first', threadId: 'thread', turnId: 'turn', text: 'original' })
  const second = { ...first, id: 'second', text: 'keep this' }
  await store.rewriteItems('thread', [first, second])
  const snapshot = await store.loadItemSnapshot('thread')
  return { store, first, second, snapshot }
}

describe('revision-bound item history references', () => {
  it('preserves ordering and changed/new content while referencing unchanged items', async () => {
    const { store, first, second, snapshot } = await fixture()
    const changed = { ...first, text: 'replacement' }
    const added = { ...first, id: 'third', text: 'new' }
    const items = [second, changed, added]
    const itemReferences = referenceUnchangedItems(snapshot, items)
    expect(itemReferences).toEqual(['second', changed, added])
    await expect(rewriteSessionHistory(store, {
      threadId: 'thread', expectedRevision: snapshot.revision, itemReferences
    })).resolves.toMatchObject({ applied: true })
    expect(await store.loadItems('thread')).toEqual(items)
  })

  it('rejects stale references without overwriting an intervening append', async () => {
    const { store, first, snapshot } = await fixture()
    await store.appendItem('thread', { ...first, id: 'newer' })
    await expect(rewriteSessionHistory(store, {
      threadId: 'thread', expectedRevision: snapshot.revision, itemReferences: ['first']
    })).resolves.toMatchObject({ applied: false, reason: 'conflict' })
    expect((await store.loadItems('thread')).map((item) => item.id)).toEqual(['first', 'second', 'newer'])
  })

  it('keeps the CAS check when history changes after reference resolution', async () => {
    const { store, first, snapshot } = await fixture()
    const read = store.loadItemSnapshot.bind(store)
    vi.spyOn(store, 'loadItemSnapshot').mockImplementationOnce(async (id) => {
      const result = await read(id)
      await store.appendItem(id, { ...first, id: 'racing' })
      return result
    })
    await expect(rewriteSessionHistory(store, {
      threadId: 'thread', expectedRevision: snapshot.revision, itemReferences: []
    })).resolves.toMatchObject({ applied: false, reason: 'conflict' })
    expect((await store.loadItems('thread')).map((item) => item.id)).toContain('racing')
  })

  it('rejects missing references, ambiguous envelopes, and expired fences without changing history', async () => {
    const { store, snapshot } = await fixture()
    const body = { threadId: 'thread', expectedRevision: snapshot.revision }
    await expect(rewriteSessionHistory(store, { ...body, itemReferences: ['missing'] })).rejects.toThrow('reference is missing')
    await expect(rewriteSessionHistory(store, { ...body, items: [], itemReferences: [] })).rejects.toThrow()
    await expect(rewriteSessionHistory(store, { ...body, itemReferences: [] }, () => {
      throw new Error('stale fence')
    })).rejects.toThrow('stale fence')
    expect(await store.loadItemSnapshot('thread')).toEqual(snapshot)
  })

  it('continues to accept the legacy full-item request', async () => {
    const { store, snapshot } = await fixture()
    await expect(rewriteSessionHistory(store, {
      threadId: 'thread', expectedRevision: snapshot.revision, items: []
    })).resolves.toMatchObject({ applied: true })
    expect(await store.loadItems('thread')).toEqual([])
  })
})
