import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { makeUserItem } from '../../domain/item.js'
import { FileSessionStore } from './file-session-store.js'
import { InMemorySessionStore } from '../in-memory-session-store.js'

describe.each(['file', 'memory'])('canonical history generation (%s)', kind => {
  it('survives file-store restart, stays stable on append/compaction, and changes on explicit replacements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-history-version-'))
    const store = kind === 'file' ? new FileSessionStore({ dataDir: root }) : new InMemorySessionStore()
    const item = makeUserItem({ id: 'one', threadId: 'thread', turnId: 'turn', text: 'first' })
    try {
      await store.appendItem('thread', item)
      const first = await store.itemHistoryVersion('thread')
      await store.appendItem('thread', makeUserItem({ id: 'one', threadId: 'thread', turnId: 'turn', text: 'updated' }))
      if (store instanceof FileSessionStore) await store.compactItems('thread', { force: true })
      expect(await store.itemHistoryVersion('thread')).toBe(first)
      await store.rewriteItems('thread', [item])
      const rewritten = await store.itemHistoryVersion('thread')
      expect(rewritten).not.toBe(first)
      if (kind === 'file') expect(await new FileSessionStore({ dataDir: root }).itemHistoryVersion('thread')).toBe(rewritten)
      const snapshot = await store.loadItemSnapshot('thread')
      expect(await store.rewriteItemsIfRevision('thread', snapshot.revision - 1, [])).toMatchObject({ applied: false })
      expect(await store.itemHistoryVersion('thread')).toBe(rewritten)
      expect(await store.rewriteItemsIfRevision('thread', snapshot.revision, [])).toMatchObject({ applied: true })
      expect(await store.itemHistoryVersion('thread')).not.toBe(rewritten)
      expect(await store.loadItems('thread')).toEqual([])
    } finally { if (store instanceof FileSessionStore) await store.close(); await rm(root, { recursive: true, force: true }) }
  })
})
