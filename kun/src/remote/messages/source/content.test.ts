import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { historyReferenceFixture } from '../../../../tests/support/history-reference-fixtures.js'
import { RemoteSourceContent } from './content.js'
import { SourceContentParams } from './content-contracts.js'
import { longSource } from './content.test-support.js'
import type { ServerRuntime } from '../../../server/routes/server-runtime.js'
describe('bounded exact external history source content', () => {
  it('supports actual OpenCode maximum opaque identities without admitting paths or unsafe ordinals', async () => {
    const f = await historyReferenceFixture('opencode')
    try {
      const path = join(f.root, 'long-identities.json'), sessionId = 's'.repeat(256), userId = 'a'.repeat(256)
      await writeFile(path, JSON.stringify({ info: { id: sessionId, title: 'Long opaque identities', directory: f.root, time: { created: 1, updated: 2 } },
        messages: [{ info: { id: userId, role: 'user', time: { created: 1 } }, parts: [{ id: 'input', type: 'text', text: 'Question' }] },
          { info: { id: 'zanswer', role: 'assistant', parentID: userId, time: { created: 1, completed: 2 }, finish: 'stop' },
            parts: [{ id: 'output', type: 'text', text: 'Complete answer' }] }] }))
      const { thread, reference } = await f.historyReferences.createBranch({ path, sourceProvider: 'opencode', idempotencyKey: 'long-identities' })
      const page = await f.historyReferences.page(reference.id, { threadId: thread.id }), item = page.turns[0].items.at(-1)!
      expect(item.turnId.length).toBeGreaterThan(480)
      const params = { resource: { kind: 'code' as const, id: thread.id }, referenceId: reference.id,
        historyVersion: await f.sessionStore.itemHistoryVersion(thread.id), turnId: item.turnId, messageId: item.id }
      expect((await new RemoteSourceContent(f as unknown as ServerRuntime).get(params)).content.text).toBe('Complete answer')
      for (const ordinal of ['01', '1000000000000000']) expect(SourceContentParams.safeParse({ ...params, messageId: params.turnId + ':item:' + ordinal }).success).toBe(false)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  it.each(['codex', 'claude-code', 'opencode'] as const)('reads complete %s text across Unicode-safe pages without persisting a native copy', async (provider) => {
    const f = await historyReferenceFixture(provider)
    try {
      const source = await longSource(f.root, f.historyReferences, provider), runtime = f as unknown as ServerRuntime
      const reader = new RemoteSourceContent(runtime), params = { resource: { kind: 'code' as const, id: source.thread.id },
        referenceId: source.reference.id, historyVersion: await f.sessionStore.itemHistoryVersion(source.thread.id),
        turnId: source.item.turnId, messageId: source.item.id, maxChars: 16384 }
      expect(JSON.stringify(source.item)).not.toContain('_SOURCE_COMPLETE_TAIL')
      let cursor: string | undefined, result = '', offset = 0, pages = 0
      do {
        const page = await reader.get({ ...params, cursor })
        expect(page.content).toMatchObject({ field: 'text', offset, totalChars: source.text.length })
        expect(page.content.text.length).toBeLessThanOrEqual(16384)
        expect(page.content.text).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/u)
        result += page.content.text; offset += page.content.text.length; cursor = page.nextCursor; pages++
        expect(page.hasMore).toBe(cursor !== undefined)
        expect(JSON.stringify(page)).not.toContain(f.root)
      } while (cursor)
      expect(pages).toBeGreaterThan(2); expect(result).toBe(source.text)
      expect(await f.sessionStore.loadItems(source.thread.id)).toEqual([])
      expect((await f.threadService.getMetadata(source.thread.id))?.turns).toEqual([])
      if (provider === 'codex') for (const kind of ['tool_result', 'tool_call'] as const) {
        const item = source.page.turns.flatMap((turn) => turn.items).find((item) => item.kind === kind)!
        let next: string | undefined, text = ''
        do {
          const page = await reader.get({ ...params, turnId: item.turnId, messageId: item.id, cursor: next })
          text += page.content.text; next = page.nextCursor
        } while (next)
        expect(text).toBe(kind === 'tool_result' ? source.text : JSON.stringify({ query: source.text }, null, 2))
      }
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  it('binds the cursor to thread, reference, exact record, version and caller scope; rejects records after the branch cutoff', async () => {
    const f = await historyReferenceFixture()
    try {
      const source = await longSource(f.root, f.historyReferences, 'codex'), reader = new RemoteSourceContent(f as unknown as ServerRuntime)
      const p = { resource: { kind: 'code' as const, id: source.thread.id }, referenceId: source.reference.id,
        historyVersion: await f.sessionStore.itemHistoryVersion(source.thread.id), turnId: source.item.turnId, messageId: source.item.id }
      const first = await reader.get(p), another = await f.historyReferences.createBranch({ referenceId: source.reference.id, idempotencyKey: 'same-reference-other-thread' })
      await expect(reader.get({ ...p, resource: { kind: 'code', id: another.thread.id }, cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      await expect(reader.get({ ...p, referenceId: f.reference.id })).rejects.toThrow('HISTORY_CHANGED')
      const item = source.page.turns[0].items[0]
      await expect(reader.get({ ...p, messageId: item.id, cursor: first.nextCursor })).rejects.toThrow('INVALID_CURSOR')
      await expect(reader.get({ ...p, cursor: first.nextCursor }, { scope: 'guest', authorize: async () => {} })).rejects.toThrow('INVALID_CURSOR')
      const laterTurn = 'codex:' + source.sessionId + ':turn-2'
      await expect(reader.get({ ...p, turnId: laterTurn, messageId: laterTurn + ':item:10' })).rejects.toThrow('NOT_FOUND')
      await expect(reader.get({ ...p, historyVersion: 'stale', cursor: first.nextCursor })).rejects.toThrow('HISTORY_CHANGED')
      for (const invalid of ['/etc/passwd', 'codex:session:../private', 'codex:session:turn%2Fprivate'])
        expect(SourceContentParams.safeParse({ ...p, turnId: invalid, messageId: invalid + ':item:0' }).success).toBe(false)
      expect(SourceContentParams.safeParse({ ...p, path: '/private' }).success).toBe(false)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  it('rejects a replaced reference fingerprint or history generation and emits fixed disabled/missing/changed errors', async () => {
    const f = await historyReferenceFixture()
    try {
      const source = await longSource(f.root, f.historyReferences, 'codex'), reader = new RemoteSourceContent(f as unknown as ServerRuntime)
      const p = { resource: { kind: 'code' as const, id: source.thread.id }, referenceId: source.reference.id,
        historyVersion: await f.sessionStore.itemHistoryVersion(source.thread.id), turnId: source.item.turnId, messageId: source.item.id }
      const first = await reader.get(p), get = f.historyReferences.get.bind(f.historyReferences)
      const fingerprint = vi.spyOn(f.historyReferences, 'get').mockImplementation(async (id) => {
        const ref = await get(id); return ref ? { ...ref, cutoffTurnId: ref.cutoffTurnId + '-replaced' } : null
      })
      await expect(reader.get({ ...p, cursor: first.nextCursor })).rejects.toThrow('HISTORY_CHANGED')
      fingerprint.mockRestore()
      const original = f.historyReferences.page.bind(f.historyReferences)
      const midRead = vi.spyOn(f.historyReferences, 'page').mockImplementationOnce(async (...args) => {
        const page = await original(...args)
        vi.spyOn(f.sessionStore, 'itemHistoryVersion').mockResolvedValue('generation-changed-while-reading')
        return page
      })
      await expect(reader.get(p)).rejects.toThrow('HISTORY_CHANGED')
      midRead.mockRestore(); vi.mocked(f.sessionStore.itemHistoryVersion).mockRestore()
      const version = vi.spyOn(f.sessionStore, 'itemHistoryVersion').mockResolvedValue('new-generation')
      await expect(reader.get({ ...p, cursor: first.nextCursor })).rejects.toThrow('HISTORY_CHANGED')
      version.mockRestore()
      f.disable(); expect(reader.available).toBe(false)
      await expect(reader.get(p)).rejects.toThrow('SOURCE_HISTORY_DISABLED')
    } finally { await rm(f.root, { recursive: true, force: true }) }
    const changed = await historyReferenceFixture()
    try {
      const source = await longSource(changed.root, changed.historyReferences, 'codex'), reader = new RemoteSourceContent(changed as unknown as ServerRuntime)
      const p = { resource: { kind: 'code' as const, id: source.thread.id }, referenceId: source.reference.id,
        historyVersion: await changed.sessionStore.itemHistoryVersion(source.thread.id), turnId: source.item.turnId, messageId: source.item.id }
      await writeFile(source.path, 'SOURCE_REPLACED\n')
      await expect(reader.get(p)).rejects.toThrow('HISTORY_CHANGED')
      await rm(source.path)
      await expect(reader.get(p)).rejects.toThrow('SOURCE_HISTORY_MISSING')
    } finally { await rm(changed.root, { recursive: true, force: true }) }
  })
  it('caps concurrent source parsers across facade instances and keeps timed-out work in its slot until it actually stops', async () => {
    const f = await historyReferenceFixture()
    try {
      const source = await longSource(f.root, f.historyReferences, 'codex'), runtime = f as unknown as ServerRuntime
      const a = new RemoteSourceContent(runtime), b = new RemoteSourceContent(runtime), p = { resource: { kind: 'code' as const, id: source.thread.id },
        referenceId: source.reference.id, historyVersion: await f.sessionStore.itemHistoryVersion(source.thread.id), turnId: source.item.turnId, messageId: source.item.id }
      let release!: (value: any) => void
      const stalled = new Promise<any>((resolve) => { release = resolve }), original = f.historyReferences.page.bind(f.historyReferences)
      vi.spyOn(f.historyReferences, 'page').mockReturnValue(stalled)
      vi.useFakeTimers()
      const one = a.get(p), two = b.get(p)
      const checks = [expect(one).rejects.toThrow('SOURCE_HISTORY_UNAVAILABLE'), expect(two).rejects.toThrow('SOURCE_HISTORY_UNAVAILABLE')]
      await expect(a.get(p)).rejects.toThrow('SOURCE_HISTORY_BUSY')
      await vi.advanceTimersByTimeAsync(5001); await Promise.all(checks)
      await expect(a.get(p)).rejects.toThrow('SOURCE_HISTORY_BUSY')
      vi.useRealTimers(); release(await original(source.reference.id, { threadId: source.thread.id, turnId: source.item.turnId, itemId: source.item.id, limit: 1 }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally { vi.useRealTimers(); await rm(f.root, { recursive: true, force: true }) }
  })
})
