import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { sourceSearchFixture } from './search.test-support.js'
import { RemoteCodeManagement } from '../../code/management.js'
import { RemoteMessages } from '../service.js'
describe('bounded native and frozen-source full text search', () => {
  it.each(['codex', 'claude-code', 'opencode'] as const)('finds %s source-only text/tool content and continues after native matches without duplicates', async (provider) => {
    const text = 'x'.repeat(16380) + 'CROSS_CHUNK_TOKEN' + 'x'.repeat(60000) + ' SOURCE_ONLY_TOKEN MIXED_TOKEN'
    const f = await sourceSearchFixture(provider, text)
    try {
      await f.append('Native MIXED_TOKEN')
      let cursor: string | undefined, matches: any[] = [], pages = 0, last: any
      do {
        last = await f.search('MIXED_TOKEN', cursor)
        matches.push(...last.messages); cursor = last.nextCursor; pages++
        if (cursor) expect(cursor.length).toBeLessThanOrEqual(2048)
        expect(Boolean(cursor)).toBe(last.hasMore); expect(pages).toBeLessThan(20)
      } while (cursor)
      expect(matches[0].messageId).toBe('native_match')
      expect(matches.slice(1).every((match) => match.sourceHistoryOrder?.referenceId === f.source.reference.id)).toBe(true)
      expect(new Set(matches.map((match) => match.messageId)).size).toBe(matches.length)
      expect(matches).toHaveLength(provider === 'codex' ? 4 : 2)
      expect(last).toMatchObject({ complete: true, coverage: { native: 'complete', source: 'complete' } })
      const cross: any[] = []; cursor = undefined
      do { const page = await f.search('CROSS_CHUNK_TOKEN', cursor, 20); cross.push(...page.messages); cursor = page.nextCursor } while (cursor)
      expect(cross.length).toBe(provider === 'codex' ? 3 : 1)
      expect(cross.every((item) => item.snippet.includes('CROSS_CHUNK_TOKEN'))).toBe(true)
      const code = new RemoteCodeManagement(f.runtime, async () => ['fake'])
      const found = await code.search({ query: 'SOURCE_ONLY_TOKEN' })
      expect(found.threads.map((row) => row.id)).toContain(f.source.thread.id)
      expect(found.coverage).toMatchObject({ sourceMatched: 1, nativeMatched: 0 })
      expect(found.complete).toBe(true)
      let outside: any; cursor = undefined
      do { outside = await f.search('AFTER_CUTOFF_SECRET', cursor, 20); expect(outside.messages).toEqual([]); cursor = outside.nextCursor } while (cursor)
      expect(outside).toMatchObject({ messages: [], hasMore: false, complete: true })
      expect(JSON.stringify(matches)).not.toContain(f.root)
    } finally { await f.close() }
  })
  it('keeps the same task pending across long-record scans before advancing the Code directory', async () => {
    const f = await sourceSearchFixture('codex', 'x'.repeat(300000) + ' LONG_SOURCE_ONLY_TOKEN')
    try {
      const search = new RemoteCodeManagement(f.runtime, async () => ['fake']), listed = vi.spyOn(f.h.threads, 'listPage')
      const first = await search.search({ query: 'LONG_SOURCE_ONLY_TOKEN', limit: 1 })
      expect(first).toMatchObject({ threads: [], hasMore: true, complete: false })
      expect(first.nextCursor!.length).toBeLessThanOrEqual(2048)
      const calls = listed.mock.calls.length
      const second = await search.search({ query: 'LONG_SOURCE_ONLY_TOKEN', limit: 1, cursor: first.nextCursor })
      expect(second.threads).toEqual([]); expect(second.hasMore).toBe(true)
      expect(listed.mock.calls.length).toBe(calls)
      let cursor = second.nextCursor, rows: string[] = [], pages = 2, last = second
      do {
        last = await search.search({ query: 'LONG_SOURCE_ONLY_TOKEN', limit: 1, cursor })
        rows.push(...last.threads.map((thread) => thread.id)); cursor = last.nextCursor; pages++
        expect(pages).toBeLessThan(15)
      } while (cursor)
      expect(rows).toEqual([f.source.thread.id]); expect(last.complete).toBe(true)
      expect(last.coverage.sourceMatched).toBe(1)
    } finally { await f.close() }
  })
  it('binds continuations to task/query/ref/fingerprint/history version and the caller scope', async () => {
    const f = await sourceSearchFixture('codex', 'x'.repeat(300000) + 'needle')
    try {
      const first = await f.search('needle'), reader = new RemoteMessages(f.runtime), p = { resource: f.resource, query: 'needle', limit: 1 }
      expect(first.messages).toEqual([]); expect(first.hasMore).toBe(true)
      await expect(f.search('different', first.nextCursor)).rejects.toThrow('INVALID_CURSOR')
      const other = await f.runtime.historyReferences!.createBranch({ referenceId: f.source.reference.id, idempotencyKey: 'same-ref-other-task' })
      await expect(reader.search({ ...p, resource: { kind: 'code', id: other.thread.id }, cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      const a = await reader.search(p, { scope: 'member-A', authorize: async () => {} })
      await expect(reader.search({ ...p, cursor: a.nextCursor }, { scope: 'member-B', authorize: async () => {} })).rejects.toThrow('INVALID_CURSOR')
      const get = f.runtime.historyReferences!.get.bind(f.runtime.historyReferences)
      const replaced = vi.spyOn(f.runtime.historyReferences!, 'get').mockImplementation(async (id) => {
        const value = await get(id); return value ? { ...value, cutoffTurnId: value.cutoffTurnId + '-changed' } : null
      })
      await expect(f.search('needle', first.nextCursor)).rejects.toThrow('HISTORY_CHANGED')
      replaced.mockRestore()
      await f.h.sessionStore.rewriteItems(f.source.thread.id, [])
      await expect(f.search('needle', first.nextCursor)).rejects.toThrow('HISTORY_CHANGED')
    } finally { await f.close() }
  })
  it('reports disabled, missing, changed and partial sources as incomplete while preserving native results', async () => {
    for (const failure of ['disabled', 'missing', 'changed', 'partial'] as const) {
      const f = await sourceSearchFixture('codex', 'recorded SOURCE_TOKEN')
      try {
        await f.append('NATIVE_TOKEN')
        if (failure === 'disabled') f.disable()
        else if (failure === 'missing') await rm(f.source.path)
        else if (failure === 'changed') await writeFile(f.source.path, 'REPLACED\n')
        else {
          const page = f.runtime.historyReferences!.page.bind(f.runtime.historyReferences)
          vi.spyOn(f.runtime.historyReferences!, 'page').mockImplementation(async (...args) => ({ ...await page(...args), status: 'partial' }))
        }
        const result = await f.search('NATIVE_TOKEN', undefined, 20)
        expect(result.messages.map((match: any) => match.messageId)).toEqual(['native_match'])
        expect(result).toMatchObject({ hasMore: false, complete: false, coverage: { native: 'complete', source: failure } })
        const code = await new RemoteCodeManagement(f.runtime, async () => ['fake']).search({ query: 'unknown-source-word' })
        expect(code).toMatchObject({ threads: [], hasMore: false, complete: false, coverage: { sourceUnavailable: 1 } })
      } finally { await f.close() }
    }
  })
  it('retains native search when a source parser stalls and never starts more than two real unfinished parsers', async () => {
    const f = await sourceSearchFixture()
    try {
      await f.append('NATIVE_TOKEN')
      vi.spyOn(f.runtime.historyReferences!, 'get').mockResolvedValue(f.source.reference)
      const page = vi.spyOn(f.runtime.historyReferences!, 'page').mockReturnValue(new Promise(() => {}))
      vi.useFakeTimers()
      for (let i = 0; i < 2; i++) {
        const result = f.search('NATIVE_TOKEN', undefined, 20)
        await vi.advanceTimersByTimeAsync(5001)
        expect(await result).toMatchObject({ messages: [{ messageId: 'native_match' }], complete: false,
          coverage: { source: 'unavailable' } })
      }
      expect(await f.search('NATIVE_TOKEN', undefined, 20)).toMatchObject({ complete: false, messages: [{ messageId: 'native_match' }] })
      expect(page).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers(); await f.close() }
  })
  it('keeps cursors under 2048 with maximum OpenCode identities instead of embedding source turn/item strings', async () => {
    const f = await sourceSearchFixture('opencode')
    try {
      const path = join(f.root, 'maximum-source.json'), sessionId = 's'.repeat(256), userId = 'a'.repeat(256)
      await writeFile(path, JSON.stringify({ info: { id: sessionId, title: 'Large source identities', directory: f.root, time: { created: 1, updated: 2 } },
        messages: [{ info: { id: userId, role: 'user', time: { created: 1 } }, parts: [{ id: 'input', type: 'text', text: 'Question' }] },
          { info: { id: 'zanswer', role: 'assistant', parentID: userId, time: { created: 1, completed: 2 }, finish: 'stop' },
            parts: [{ id: 'output', type: 'text', text: 'x'.repeat(300000) + ' unique-tail' }] }] }))
      const branch = await f.runtime.historyReferences!.createBranch({ path, sourceProvider: 'opencode', idempotencyKey: 'maximum-source' })
      const first = await new RemoteMessages(f.runtime).search({ resource: { kind: 'code', id: branch.thread.id }, query: 'unique-tail', limit: 1 })
      expect(first.hasMore).toBe(true); expect(first.nextCursor!.length).toBeLessThanOrEqual(2048)
      expect(Buffer.from(first.nextCursor!, 'base64url').toString()).not.toContain(sessionId)
      const code = await new RemoteCodeManagement(f.runtime, async () => ['fake']).search({ query: 'unique-tail', limit: 1 })
      expect(code.hasMore).toBe(true); expect(code.nextCursor!.length).toBeLessThanOrEqual(2048)
    } finally { await f.close() }
  })
})
