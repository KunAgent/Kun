import { describe, expect, it, vi } from 'vitest'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import type { ModelStreamChunk } from '../src/ports/model-client.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

// Synthetic missing-note/crash results reproduce the loop without reading any
// user's private notes. They do not assert the original incident's first error.
describe('repeated failed tool recovery', () => {
  it.each(['only', 'mixed', 'alternating', 'invalid-batch'])('terminates an insistent model (%s)', async (mode) => {
    let requests = 0
    const execute = vi.fn(async () => { throw new Error('synthetic note not found') })
    const setTimer = vi.fn(() => ({ cancel: vi.fn() }))
    const h = makeHarness({
      provider: 'fake', model: 'fake',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        requests++
        if (requests > 12) throw new Error('test safety bound exceeded')
        if (mode === 'alternating' && requests > 4 && requests % 2 === 1) {
          yield { kind: 'tool_call_complete', callId: `echo-${requests}`, toolName: 'echo', arguments: {} }
        } else {
          yield { kind: 'tool_call_complete', callId: `note-${requests}`, toolName: 'notes_read_file', arguments: { path: 'minimax-execution.md' } }
          if (mode === 'mixed') yield { kind: 'tool_call_complete', callId: `echo-${requests}`, toolName: 'echo', arguments: {} }
          if (mode === 'invalid-batch') yield { kind: 'tool_call_complete', callId: `context-${requests}`, toolName: 'new_context', arguments: {} }
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }, { goalResume: { setTimer }, tools: [
      LocalToolHost.defineTool({ name: 'new_context', description: 'Transition', inputSchema: { type: 'object' }, policy: 'auto', execute }),
      LocalToolHost.defineTool({ name: 'notes_read_file', description: 'Read note', inputSchema: { type: 'object' }, policy: 'auto', execute }),
      LocalToolHost.defineTool({ name: 'echo', description: 'Unrelated success', inputSchema: { type: 'object' }, policy: 'auto', execute: async () => ({ output: { ok: true } }) })
    ] })
    await bootstrapThread(h)
    await h.threads.setGoal(h.threadId, { objective: 'Read the note', status: 'active' })
    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('failed')
    expect(execute).toHaveBeenCalledTimes(mode === 'invalid-batch' ? 0 : 3)
    expect(requests).toBeLessThanOrEqual(9)
    expect(setTimer).not.toHaveBeenCalled()
    const items = await h.sessionStore.loadItems(h.threadId)
    expect(items).toContainEqual(expect.objectContaining({ kind: 'error', code: 'tool_loop_suppressed' }))
    const calls = items.filter((item) => item.kind === 'tool_call')
    const results = items.filter((item) => item.kind === 'tool_result')
    for (const call of calls) {
      if (call.kind === 'tool_call') expect(results.filter((item) => item.kind === 'tool_result' && item.callId === call.callId)).toHaveLength(1)
    }
    expect(h.inflight.size()).toBe(0)
  })

  it.each(['final', 'repair'])('allows %s after suppression without restarting the failed call loop', async (recovery) => {
    let requests = 0
    let reads = 0
    let repaired = false
    const h = makeHarness({
      provider: 'fake', model: 'fake',
      async *stream(): AsyncIterable<ModelStreamChunk> {
        requests++
        if (requests > 10) throw new Error('test safety bound exceeded')
        if (requests <= 4 || (recovery === 'repair' && requests === 6)) {
          yield { kind: 'tool_call_complete', callId: `note-${requests}`, toolName: 'notes_read_file', arguments: { path: 'a.md' } }
        } else if (recovery === 'repair' && requests === 5) {
          yield { kind: 'tool_call_complete', callId: 'write', toolName: 'notes_write_file', arguments: { path: 'a.md' } }
        } else {
          yield { kind: 'assistant_text_delta', text: repaired ? 'Note read successfully.' : 'The note is unavailable; the repeated reads were stopped.' }
          yield { kind: 'completed', stopReason: 'stop' }
          return
        }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      }
    }, { tools: [
      LocalToolHost.defineTool({ name: 'notes_read_file', description: 'Read note', inputSchema: { type: 'object' }, policy: 'auto', execute: async () => {
        reads++
        return { output: repaired ? { content: 'recovered' } : { error: 'synthetic missing note' }, isError: !repaired }
      } }),
      LocalToolHost.defineTool({ name: 'notes_write_file', description: 'Repair note', inputSchema: { type: 'object' }, policy: 'auto', execute: async () => {
        repaired = true
        return { output: { status: 'ok', path: 'a.md', revision: 1 } }
      } })
    ] })
    await bootstrapThread(h)
    await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
    expect(reads).toBe(recovery === 'repair' ? 4 : 3)
    expect(requests).toBe(recovery === 'repair' ? 7 : 5)
  })
})
