import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReferenceBranch, historyBlocks, historyRequest, isSourceHistoryTurn } from './history-reference-api'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { threadFromCore } from '../agent/kun-mapper'

afterEach(() => vi.restoreAllMocks())

describe('Codex branch renderer contracts', () => {
  it('submits only a source reference and branch options, with no historical bodies', async () => {
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({ ok: true, status: 200,
      body: JSON.stringify({ thread: { id: 'kun-new' }, reference: { id: 'ref-1' } }) })
    await createReferenceBranch({ path: '/codex/session.jsonl', cutoffTurnId: 'codex:s:1', idempotencyKey: 'request-1' })
    expect(request).toHaveBeenCalledWith('/v1/threads/reference-branches', 'POST',
      JSON.stringify({ path: '/codex/session.jsonl', cutoffTurnId: 'codex:s:1', idempotencyKey: 'request-1' }), { signal: undefined })
  })
  it('reports disabled runtime errors without silently creating a normal session', async () => {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({ ok: false, status: 403,
      body: JSON.stringify({ code: 'history_reference_disabled', message: 'Enable laboratory feature' }) })
    await expect(historyRequest('/v1/history-sources/codex/sessions')).rejects.toThrow('Enable laboratory feature')
  })
  it('keeps reference identity on normalized threads and attachments on read-only history', () => {
    expect(threadFromCore({ id: 'new', title: 'branch', model: 'model', mode: 'agent', status: 'idle',
      createdAt: '2026-01-01', updatedAt: '2026-01-01', historyRefId: 'source-1' }).historyRefId).toBe('source-1')
    const blocks = historyBlocks({ id: 'codex:s:turn-1', threadId: 'new', prompt: '', status: 'completed', createdAt: '2026-01-01',
      items: [{ id: 'codex:s:record-1', turnId: 'codex:s:turn-1', threadId: 'new', role: 'user', kind: 'user_message', status: 'completed',
        createdAt: '2026-01-01', text: 'Old prompt', sourceAttachments: [{ index: 0, name: 'screen.png', mimeType: 'image/png' }] }] })
    expect(blocks[0]).toMatchObject({ kind: 'user', text: 'Old prompt', sourceItemId: 'codex:s:record-1',
      sourceAttachments: [{ index: 0, name: 'screen.png', mimeType: 'image/png' }] })
    expect(isSourceHistoryTurn(blocks[0]!)).toBe(true)
    expect(isSourceHistoryTurn({ turnId: 'kun-turn' })).toBe(false)
  })
  it('keeps both source call and result pointers after tool cards merge', () => {
    const common = { turnId: 'codex:s:t', threadId: 'branch', status: 'completed' as const, createdAt: '2026-01-01', callId: 'call-1', toolName: 'shell' }
    const blocks = historyBlocks({ id: common.turnId, threadId: common.threadId, prompt: '', status: 'completed', createdAt: common.createdAt, items: [
      { ...common, id: 'codex:call-item', role: 'assistant', kind: 'tool_call', arguments: { command: 'long command' } },
      { ...common, id: 'codex:result-item', role: 'tool', kind: 'tool_result', output: 'long output' }
    ] })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.sourceRecords).toEqual([
      { itemId: 'codex:call-item', kind: 'tool_call' }, { itemId: 'codex:result-item', kind: 'tool_result' }
    ])
  })

})
