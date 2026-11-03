import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from './kun-contract'
import type { ToolBlock } from './types'
import { chatBlockFromItem, mergeChatBlocks } from './kun-mapper'
import { mergeToolPresentations, readToolPresentation } from './tool-presentation'
import { mergeToolProjectionEvents, mergeToolProjectionMeta } from '../store/chat-projection-reducer-support'
import { TOOL_PRESENTATION_MAX_BYTES } from '../../../../kun/src/contracts/tool-presentation-bounds'
import type { ToolPresentation } from '@shared/tool-presentation'

function item(kind: 'tool_call' | 'tool_result', patch: Partial<CoreTurnItemJson> = {}): CoreTurnItemJson {
  return { id: kind, threadId: 'thread', turnId: 'turn', kind, callId: 'call',
    toolName: 'read', toolKind: 'tool_call', role: 'tool', status: kind === 'tool_call' ? 'pending' : 'completed',
    createdAt: '2026-10-11T00:00:00Z', ...patch }
}
function block(value: CoreTurnItemJson): ToolBlock { return chatBlockFromItem(value) as ToolBlock }

describe('shared tool presentation', () => {
  it.each([false, true])('preserves read input and output across call/result order (result first: %s)', (reverse) => {
    const call = block(item('tool_call', { arguments: { path: '/repo/a.ts', offset: 20, limit: 40 } }))
    const result = block(item('tool_result', { output: { path: '/repo/a.ts', content: 'Actual lines', start_line: 20 } }))
    const merged = mergeChatBlocks(reverse ? [result, call] : [call, result])[0] as ToolBlock
    expect(readToolPresentation(merged)).toMatchObject({ kind: 'read', state: 'completed', canCancel: false,
      line: 20, offset: 20, limit: 40, fileContent: 'Actual lines',
      input: { path: '/repo/a.ts', offset: 20, limit: 40 }, output: { content: 'Actual lines' } })
  })

  it('keeps different turns separate even when an external agent reuses its call id', () => {
    const first = block(item('tool_result', { turnId: 'first', output: 'first' }))
    const second = block(item('tool_result', { turnId: 'second', output: 'second' }))
    expect(mergeChatBlocks([first, second])).toHaveLength(2)
  })

  it('keeps explicit pending/running/completed/failed/canceled states', () => {
    for (const [status, expected] of [['pending', 'pending'], ['running', 'running'], ['completed', 'completed'], ['failed', 'failed'], ['aborted', 'canceled']] as const) {
      expect(readToolPresentation(block(item('tool_result', { status })))).toMatchObject({ state: expected })
    }
    expect(readToolPresentation(block(item('tool_result', { isError: true,
      output: { code: 'tool_cancelled_by_user', error: 'Stopped' } })))).toMatchObject({ state: 'canceled', error: 'Stopped' })
  })

  it('retains terminal output/state when an older call is replayed into the store', () => {
    const result = block(item('tool_result', { status: 'failed', output: { error: 'Denied', text: 'Final diagnostic' } }))
    const oldCall = block(item('tool_call', { status: 'running', arguments: { path: '/repo/a' },
      meta: { toolPresentation: { version: 1, state: 'running', canCancel: true } } }))
    const meta = mergeToolProjectionMeta(result.meta, oldCall.meta)
    expect(readToolPresentation({ ...result, meta })).toMatchObject({ state: 'failed', canCancel: false,
      input: { path: '/repo/a' }, output: { error: 'Denied', text: 'Final diagnostic' } })
    const lateCompletedCall = block(item('tool_call', { status: 'completed', arguments: { path: '/repo/a' } }))
    expect(readToolPresentation({ ...result, meta: mergeToolProjectionMeta(meta, lateCompletedCall.meta) }).state).toBe('failed')
  })

  it('applies the same attempt fence to block status and semantic presentation', () => {
    const terminal = { itemId: 'tool_call', summary: 'child', status: 'error' as const, detail: 'failed', meta: {
      child: { childStatus: 'failed', resumeCount: 0 }, sourceItemKind: 'tool_result',
      toolPresentation: { version: 1, kind: 'other', state: 'failed', canCancel: false, output: 'old failure' }
    } }
    const resumed = { ...terminal, status: 'running' as const, detail: undefined, meta: {
      child: { childStatus: 'running', resumeCount: 1 }, sourceItemKind: 'tool_call',
      toolPresentation: { version: 1, kind: 'other', state: 'running', canCancel: false }
    } }
    const next = mergeToolProjectionEvents(terminal, resumed)
    expect(next.status).toBe('running')
    expect(next.meta?.toolPresentation).toMatchObject({ state: 'running' })
    expect((next.meta?.toolPresentation as ToolPresentation).output).toBeUndefined()
    const late = mergeToolProjectionEvents(next, terminal)
    expect(late.status).toBe('running')
    expect(late.meta?.toolPresentation).toMatchObject({ state: 'running' })
    const stopped = mergeToolProjectionEvents(terminal, { ...terminal, status: 'success', updateOnly: true,
      meta: { ...terminal.meta, toolPresentation: { ...terminal.meta.toolPresentation, state: 'completed', output: 'minimal lifecycle' } } })
    expect(stopped.meta?.toolPresentation).toMatchObject({ state: 'failed', output: 'old failure' })
  })

  it('exposes single-tool cancel only from explicit native running capability', () => {
    const make = (toolName: string, status: CoreTurnItemJson['status'], canCancel?: boolean) => readToolPresentation(block(item('tool_call', {
      toolName, status, meta: { toolPresentation: { version: 1, canCancel } }
    })))
    expect(make('read', 'running').canCancel).toBe(false)
    expect(make('read', 'running', true).canCancel).toBe(true)
    expect(make('acp:read', 'running', true).canCancel).toBe(false)
    expect(make('read', 'completed', true).canCancel).toBe(false)
  })

  it('normalizes search hits, fetch status and MCP identity without discarding raw payloads', () => {
    const search = mergeChatBlocks([
      block(item('tool_call', { toolName: 'grep', arguments: { pattern: 'needle', path: '/repo' } })),
      block(item('tool_result', { toolName: 'grep', output: { matches: [{ path: '/repo/a', line_number: 8, text: 'needle' }] } }))
    ])[0] as ToolBlock
    expect(readToolPresentation(search)).toMatchObject({ kind: 'search', query: 'needle', results: [{ path: '/repo/a', line: 8, text: 'needle' }] })
    const fetch = readToolPresentation(block(item('tool_result', { toolName: 'web_fetch',
      output: { url: 'https://example.test/page', status_code: 404, text: 'Missing' } })))
    expect(fetch).toMatchObject({ kind: 'fetch', url: 'https://example.test/page', statusCode: 404 })
    expect(readToolPresentation(block(item('tool_call', { toolName: 'mcp__docs__lookup', arguments: { query: 'topic' } }))))
      .toMatchObject({ kind: 'mcp', server: 'docs', name: 'lookup', input: { query: 'topic' } })
  })

  it('uses the actual native write/edit, paged grep and direct MCP result shapes', () => {
    const written = mergeChatBlocks([
      block(item('tool_call', { toolName: 'write', arguments: { path: '/repo/a.ts', content: 'export const a = 1\n' } })),
      block(item('tool_result', { toolName: 'write', output: { path: '/repo/a.ts', relative_path: 'a.ts', changed: true, bytes_written: 19 } }))
    ])[0] as ToolBlock
    expect(readToolPresentation(written)).toMatchObject({ kind: 'edit', fileContent: 'export const a = 1\n' })
    const patch = '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n'
    expect(readToolPresentation(block(item('tool_result', { toolName: 'edit', output: {
      path: '/repo/a.ts', relative_path: 'a.ts', replacements: 1, bytes_written: 4,
      diff: '- old\n+ new', patch, first_changed_line: 1
    } })))).toMatchObject({ kind: 'edit', patch })
    expect(readToolPresentation(block(item('tool_result', { toolName: 'grep', output: {
      path: '/repo', relative_path: '.', pattern: 'find', backend: 'rg', matches: [{ path: '/repo/a.ts', relative_path: 'a.ts', line: 2, text: 'find me' }],
      truncated: true, has_more: true, next_cursor: 'opaque'
    } })))).toMatchObject({ kind: 'search', query: 'find', results: [{ path: '/repo/a.ts', line: 2, text: 'find me' }], truncated: true })
    expect(readToolPresentation(block(item('tool_result', { toolName: 'mcp_documents_search', toolKind: 'command_execution', output: {
      serverId: 'documents', toolName: 'search', result: { content: [{ type: 'text', text: 'Found a document' }] }
    } })))).toMatchObject({ kind: 'mcp', server: 'documents', name: 'search', content: [{ type: 'text', text: 'Found a document' }] })
    expect(readToolPresentation(block(item('tool_result', { toolName: 'mcp_read_resource', output: {
      serverId: 'documents', uri: 'resource://report', result: { contents: [{ uri: 'resource://report', mimeType: 'text/plain', text: 'Report' }] }
    } })))).toMatchObject({ kind: 'mcp', server: 'documents', content: [{ type: 'resource', resource: { uri: 'resource://report', text: 'Report' } }] })
  })

  it('retains legacy ACP fields and validates malformed optional collections', () => {
    const legacy: ToolBlock = { kind: 'tool', id: 'legacy', summary: 'acp:edit', status: 'success', meta: {
      acpKind: 'edit', acpTitle: 'Update source', acpInput: { path: '/repo/a' }, acpText: 'Explanation',
      acpDiffs: [null, {}, { path: '/repo/a', oldText: 'before', newText: 'after' }],
      acpTerminals: [{ terminalId: 'broken', output: {} }, { terminalId: 't', output: 'Stopped', signal: 'SIGTERM' }]
    } }
    expect(readToolPresentation(legacy)).toMatchObject({ state: 'completed', title: 'Update source', text: 'Explanation',
      input: { path: '/repo/a' }, diffs: [{ path: '/repo/a', oldText: 'before', newText: 'after' }],
      terminals: [{ terminalId: 't', output: 'Stopped', signal: 'SIGTERM' }] })
  })

  it('uses a bounded weak cache and observes replacement metadata', () => {
    const current = block(item('tool_result', { output: 'data' }))
    const first = readToolPresentation(current)
    expect(readToolPresentation(current)).toBe(first)
    const changed = { ...current, meta: { ...current.meta,
      toolPresentation: { ...first, title: 'Updated title' } } }
    expect(readToolPresentation(changed).title).toBe('Updated title')
    expect(readToolPresentation(changed)).not.toBe(first)
  })

  it('bounds huge native semantic fields as well as the raw output', () => {
    const output = { content: 'x'.repeat(10 * 1024 * 1024), path: '/repo/large' }
    const presentation = readToolPresentation(block(item('tool_result', { output })))
    expect(presentation.truncated).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(presentation)).byteLength).toBeLessThanOrEqual(TOOL_PRESENTATION_MAX_BYTES)
    expect(presentation.fileContent!.length).toBeLessThan(100_000)
    expect(output.content.length).toBe(10 * 1024 * 1024)
  })

  it('preserves input when merging sparse terminal presentation data', () => {
    const current: ToolPresentation = { version: 1, kind: 'execute', state: 'running', canCancel: true, input: { command: 'npm test' } }
    expect(mergeToolPresentations(current, { version: 1, kind: 'execute', state: 'completed', canCancel: false, output: 'OK' }))
      .toMatchObject({ input: { command: 'npm test' }, output: 'OK', state: 'completed', canCancel: false })
  })
})
