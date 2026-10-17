import { describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FileSessionStore } from '../../adapters/file/file-session-store.js'
import { createApprovalRequest } from '../../domain/approval.js'
import type { TurnItem } from '../../contracts/items.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
const textItem = (threadId: string, id: string, text: string): TurnItem => ({
  kind: 'assistant_text', role: 'assistant', status: 'completed', threadId, turnId: 'turn_history', id, text, createdAt: '2026-01-01T00:00:00.000Z'
})
describe('Remote bounded canonical reads', () => {
  it('continues beyond the newest hundred indexed items and a long canonical field, then rejects rewritten cursors', async () => {
    const f = await remoteFixture(), sessions = new FileSessionStore({ dataDir: f.root, compactionDelayMs: 60000 })
    try {
      const task = await f.code(), resource = { kind: 'code', id: task.id }
      f.runtime.sessionStore = sessions
      await sessions.appendItem(task.id, textItem(task.id, 'old_match', 'old needle in history'))
      await sessions.appendItem(task.id, textItem(task.id, 'long_match', 'x'.repeat(180000) + ' needle tail'))
      for (let i = 0; i < 130; i++) await sessions.appendItem(task.id, textItem(task.id, 'new_' + i, 'no match'))
      const loadAll = vi.spyOn(sessions, 'loadItems')
      let cursor: string | undefined, firstCursor: string | undefined, pages = 0
      const ids = []
      do {
        const page = await f.call('message.search', { resource, query: 'needle', limit: 1, ...(cursor ? { cursor } : {}) })
        ids.push(...page.messages.map((m: any) => m.messageId)); pages++
        if (!firstCursor) firstCursor = page.nextCursor
        cursor = page.nextCursor
        expect(Boolean(cursor)).toBe(page.hasMore)
        expect(pages).toBeLessThan(12)
      } while (cursor)
      expect(ids).toEqual(['long_match', 'old_match'])
      expect(pages).toBeGreaterThan(2)
      expect(loadAll).not.toHaveBeenCalled()
      await sessions.rewriteItems(task.id, [textItem(task.id, 'replacement', 'needle')])
      await expect(f.call('message.search', { resource, query: 'needle', cursor: firstCursor })).rejects.toThrow('HISTORY_CHANGED')
    } finally { await sessions.close(); await f.close() }
  })
  it('reads full tool output in stable fragments and cannot read a hidden or wrongly bound item', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), resource = { kind: 'code', id: task.id }, output = '😀result '.repeat(5000)
      await f.h.sessionStore.appendItem(task.id, { kind: 'tool_result', id: 'tool_output', threadId: task.id,
        role: 'tool', status: 'completed', toolKind: 'tool_call', turnId: 'turn_history', toolName: 'fixture', callId: 'call', output, isError: false,
        createdAt: '2026-01-01T00:00:00.000Z' })
      await f.h.sessionStore.appendItem(task.id, { kind: 'model_context', id: 'secret_context', threadId: task.id,
        turnId: 'turn_history', text: 'private marker', createdAt: '2026-01-01T00:00:00.000Z' } as TurnItem)
      const historyVersion = await f.h.sessionStore.itemHistoryVersion(task.id)
      let contentOffset = 0, text = '', pages = 0
      do {
        const page = await f.call('message.get', { resource, messageId: 'tool_output', turnId: 'turn_history',
          historyVersion, contentOffset, maxChars: 3000 })
        text += page.content.text; pages++
        contentOffset = page.content.nextOffset
      } while (contentOffset !== undefined)
      expect(text).toBe(output); expect(pages).toBeGreaterThan(10)
      await expect(f.call('message.get', { resource, messageId: 'tool_output', turnId: 'other_turn', historyVersion })).rejects.toThrow('NOT_FOUND')
      await expect(f.call('message.get', { resource, messageId: 'secret_context', turnId: 'turn_history', historyVersion })).rejects.toThrow('NOT_FOUND')
      await f.h.sessionStore.rewriteItems(task.id, [])
      await expect(f.call('message.get', { resource, messageId: 'tool_output', turnId: 'turn_history', historyVersion })).rejects.toThrow('HISTORY_CHANGED')
    } finally { await f.close() }
  })
  it('searches body matches beyond forty tasks and resumes partial scans without visiting ADE or hidden children', async () => {
    const f = await remoteFixture()
    try {
      const oldest = await f.code('Old task')
      await f.h.sessionStore.appendItem(oldest.id, textItem(oldest.id, 'older_body', 'full history needle'))
      for (let i = 0; i < 45; i++) await f.code('New task ' + i)
      const long = await f.code('Long content')
      await f.h.sessionStore.appendItem(long.id, textItem(long.id, 'long_body', 'x'.repeat(200000) + ' needle tail'))
      const excluded = await f.h.threads.create({ workspace: f.root, title: 'needle forbidden', model: 'fake', mode: 'agent', workspaceMode: 'ade' })
      const load = vi.spyOn(f.h.sessionStore, 'loadItemPage')
      let cursor: string | undefined, pages = 0
      const ids: string[] = []
      do {
        const page = await f.call('code.search', { query: 'needle', limit: 1, ...(cursor ? { cursor } : {}) })
        ids.push(...page.threads.map((t: any) => t.id)); pages++
        expect(page.searchScope).toBe('title_and_content')
        expect(page.complete).toBe(!page.hasMore)
        expect(page.threads.length).toBeLessThanOrEqual(1)
        cursor = page.nextCursor
        expect(pages).toBeLessThan(10)
      } while (cursor)
      expect(ids).toEqual([long.id, oldest.id]); expect(pages).toBeGreaterThan(1)
      expect(load.mock.calls.some(([id]) => id === excluded.id)).toBe(false)
    } finally { await f.close() }
  })
  it('binds Agent message reads to one personal conversation and hides setup cards', async () => {
    const f = await remoteFixture()
    try {
      const agent = (await f.rooms.agents.create({ clientRequestId: 'agent_A', name: 'Agent A' })).agent
      const other = (await f.rooms.agents.create({ clientRequestId: 'agent_B', name: 'Agent B' })).agent
      const a = (await f.call('agent.message.send', { agentId: agent.id, text: 'private needle A' })).receipt.result
      const b = (await f.call('agent.message.send', { agentId: other.id, text: 'private needle B' })).receipt.result
      const resource = { kind: 'agent', id: agent.id }
      const page = await f.call('message.search', { resource, query: 'needle' })
      expect(page.messages.map((v: any) => v.messageId)).toEqual([a.message.id])
      const got = await f.call('message.get', { resource, messageId: a.message.id, historyVersion: page.messages[0].historyVersion })
      expect(got.content.text).toBe('private needle A')
      await expect(f.call('message.get', { resource, messageId: b.message.id, historyVersion: page.messages[0].historyVersion })).rejects.toThrow('NOT_FOUND')
      const stored = await f.store.get<any>('message', a.message.id)
      await f.store.commit({ requestId: 'hide', checks: [{ kind: 'message', id: stored!.id, expectedRevision: stored!.revision }],
        puts: [{ kind: 'message', id: stored!.id, roomId: a.roomId, value: { ...stored!.value, presentationKind: 'setup' } }] })
      expect((await f.call('message.search', { resource, query: 'needle' })).messages).toEqual([])
    } finally { await f.close() }
  })
  it('aggregates only authorized Code/Agent attention and returns existing artifact handles for export', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), ade = await f.h.threads.create({ workspace: f.root, model: 'fake', mode: 'agent', workspaceMode: 'ade' })
      for (const [id, threadId] of [['valid', task.id], ['hidden', ade.id]])
        void f.h.approvalGate.request(createApprovalRequest({ id, threadId, turnId: 'turn_history', toolName: 'fixture', summary: id })).catch(() => {})
      void f.h.userInputGate.request({ id: 'input', threadId: task.id, turnId: 'turn_history', itemId: 'input_item', prompt: 'Which?', questions: [] }).catch(() => {})
      const attention = await f.call('attention.list', { limit: 1 })
      expect(attention.items[0]).toMatchObject({ id: 'valid', kind: 'approval', resource: { kind: 'code', id: task.id } })
      expect(attention.hasMore).toBe(true)
      const rest = await f.call('attention.list', { cursor: attention.nextCursor })
      expect(rest.items.map((v: any) => v.id)).toEqual(['input'])
      await writeFile(join(f.root, 'result.txt'), 'artifact bytes')
      await f.h.sessionStore.appendItem(task.id, { kind: 'tool_result', id: 'generated', threadId: task.id,
        role: 'tool', status: 'completed', toolKind: 'tool_call', turnId: 'turn_history', toolName: 'fixture', callId: 'call', isError: false,
        output: { generatedFiles: [{ path: 'result.txt' }, { path: '/etc/passwd' }] }, createdAt: '2026-01-01T00:00:00.000Z' })
      const list = await f.call('artifact.list', { resource: { kind: 'code', id: task.id } })
      expect(list.artifacts).toHaveLength(1)
      expect(list.artifacts[0]).toMatchObject({ name: 'result.txt', available: true, threadId: task.id })
      const bytes = await f.facade.artifacts.readCode(task.id, list.artifacts[0].id)
      expect(bytes.data.toString()).toBe('artifact bytes')
      await expect(f.call('artifact.list', { resource: { kind: 'code', id: ade.id } })).rejects.toThrow('NOT_A_CODE_TASK')
      f.h.userInputGate.reset(); f.h.approvalGate.expire('valid'); f.h.approvalGate.expire('hidden')
    } finally { await f.close() }
  })
  it('revokes an artifact handle after a workspace move and tolerates a missing project during history projection', async () => {
    const f = await remoteFixture()
    try {
      const task = await f.code(), nextRoot = join(f.root, 'next')
      await mkdir(nextRoot); await writeFile(join(f.root, 'before.txt'), 'before')
      const history = { id: task.id, turns: [{ items: [{ kind: 'tool_result', id: 'source',
        output: { generatedFiles: [{ path: 'before.txt' }] } }] }] }
      const [file] = await f.facade.artifacts.codeHistory(history)
      expect(file.name).toBe('before.txt')
      await f.h.threads.update(task.id, { workspace: nextRoot })
      await expect(f.facade.artifacts.readCode(task.id, file.id)).rejects.toThrow('REFRESH_HISTORY')
      await f.h.threads.update(task.id, { workspace: join(f.root, 'missing') })
      expect(await f.facade.artifacts.codeHistory(history)).toEqual([])
    } finally { await f.close() }
  })
})
