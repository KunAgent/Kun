import { describe, expect, it } from 'vitest'
import { makeToolResultItem } from '../domain/item.js'
import type { ToolCallLike } from '../ports/tool-host.js'
import { ToolStormBreaker } from './tool-storm-breaker.js'

const noteCall: ToolCallLike = { callId: 'note', toolName: 'notes_read_file', arguments: { path: 'a.md', offset: 0 } }
function result(isError: boolean, output: unknown = {}) {
  return { approved: false, item: makeToolResultItem({
    id: 'result', threadId: 'thread', turnId: 'turn', callId: 'note',
    toolName: 'notes_read_file', output, isError
  }) }
}

describe('ToolStormBreaker', () => {
  it('bounds actual failures, ignoring call IDs and object key order', () => {
    const breaker = new ToolStormBreaker()
    for (let i = 0; i < 3; i++) {
      expect(breaker.inspect(noteCall).suppress).toBe(false)
      breaker.recordResult(noteCall, result(true))
    }
    expect(breaker.inspect({ ...noteCall, callId: 'new', arguments: { offset: 0, path: 'a.md' } })).toMatchObject({
      suppress: true, reason: expect.stringContaining('failed 3 times')
    })
    expect(breaker.inspect({ ...noteCall, arguments: { path: 'a.md', offset: 10 } }).suppress).toBe(false)
    expect(breaker.inspect({ ...noteCall, arguments: { path: 'b.md' } }).suppress).toBe(false)
    breaker.recordResult({ ...noteCall, toolName: 'echo' }, result(false))
    breaker.recordResult({ ...noteCall, toolName: 'new_context' }, result(false))
    expect(breaker.inspect(noteCall).suppress).toBe(true)
    breaker.reset()
    expect(breaker.inspect(noteCall).suppress).toBe(false)
    expect(new ToolStormBreaker().inspect(noteCall).suppress).toBe(false)
  })

  it('clears only successful same-call failures, allowing repeated successful reads', () => {
    const breaker = new ToolStormBreaker()
    for (let i = 0; i < 10; i++) {
      expect(breaker.inspect(noteCall).suppress).toBe(false)
      breaker.recordResult(noteCall, result(true))
      breaker.recordResult(noteCall, result(false))
    }
  })

  it.each(['notes_write_file', 'notes_append_to_file'])('reopens reads after a confirmed %s of that note', (toolName) => {
    const breaker = new ToolStormBreaker()
    for (let i = 0; i < 3; i++) breaker.recordResult(noteCall, result(true))
    const write = { ...noteCall, toolName }
    breaker.recordResult(write, result(true))
    breaker.recordResult(write, result(false, { status: 'conflict', path: 'a.md', actualRevision: 1 }))
    breaker.recordResult({ ...write, arguments: { path: 'b.md' } }, result(false, { status: 'ok', path: 'b.md', revision: 1, applied: true }))
    expect(breaker.inspect(noteCall).suppress).toBe(true)
    breaker.recordResult(write, result(false, { status: 'ok', path: 'a.md', revision: 1, applied: true }))
    expect(breaker.inspect(noteCall).suppress).toBe(false)
    breaker.recordResult(noteCall, result(false))
    expect(breaker.inspect(noteCall).suppress).toBe(false)
  })

  it('does not reopen a failed read for a replayed append', () => {
    const breaker = new ToolStormBreaker()
    for (let i = 0; i < 3; i++) breaker.recordResult(noteCall, result(true))
    breaker.recordResult({ ...noteCall, toolName: 'notes_append_to_file' }, result(false, {
      path: 'a.md', revision: 1, applied: false
    }))
    expect(breaker.inspect(noteCall).suppress).toBe(true)
  })

  it('bounds distinct failure state without evicting a blocked fingerprint', () => {
    const breaker = new ToolStormBreaker()
    for (let i = 0; i < 3; i++) breaker.recordResult(noteCall, result(true))
    for (let i = 0; i < 1000; i++) {
      breaker.recordResult({ ...noteCall, arguments: { path: `${i}.md` } }, result(true))
    }
    expect(breaker.inspect(noteCall).suppress).toBe(true)
    expect(breaker.inspect({ ...noteCall, arguments: { path: 'new.md' } })).toMatchObject({
      suppress: true, reason: expect.stringContaining('tracking budget')
    })
  })
  it('suppresses repeated interactive user-input gates in one turn', () => {
    const breaker = new ToolStormBreaker({ interactiveThreshold: 2 })

    expect(
      breaker.inspect({ callId: 'c1', toolName: 'user_input', arguments: { prompt: 'one' } })
    ).toEqual({ suppress: false })
    expect(
      breaker.inspect({ callId: 'c2', toolName: 'request_user_input', arguments: { prompt: 'two' } })
    ).toEqual({ suppress: false })
    expect(
      breaker.inspect({ callId: 'c3', toolName: 'user_input', arguments: { prompt: 'three' } })
    ).toMatchObject({
      suppress: true,
      reason: expect.stringContaining('interactive prompt guard')
    })
  })

  it('resets the interactive prompt count between turns', () => {
    const breaker = new ToolStormBreaker({ interactiveThreshold: 1 })

    expect(
      breaker.inspect({ callId: 'c1', toolName: 'user_input', arguments: { prompt: 'one' } })
    ).toEqual({ suppress: false })
    expect(
      breaker.inspect({ callId: 'c2', toolName: 'user_input', arguments: { prompt: 'two' } })
    ).toMatchObject({ suppress: true })

    breaker.reset()

    expect(
      breaker.inspect({ callId: 'c3', toolName: 'user_input', arguments: { prompt: 'new turn' } })
    ).toEqual({ suppress: false })
  })

  it('suppresses repeated semantic Browser Use calls but allows material changes', () => {
    const breaker = new ToolStormBreaker({ browserDuplicateThreshold: 2 })
    const open = {
      toolName: 'browser_use',
      arguments: { action: 'open', url: 'https://example.com', ref: null }
    }

    expect(breaker.inspect({ ...open, callId: 'b1' })).toEqual({ suppress: false })
    expect(breaker.inspect({
      ...open,
      callId: 'b2',
      arguments: { url: 'https://example.com', action: 'open' }
    })).toEqual({ suppress: false })
    expect(breaker.inspect({ ...open, callId: 'b3' })).toMatchObject({
      suppress: true,
      reason: expect.stringContaining('duplicate browser guard')
    })
    expect(breaker.inspect({
      ...open,
      callId: 'b4',
      arguments: { action: 'open', url: 'https://example.org' }
    })).toEqual({ suppress: false })
  })

  it('does not suppress ordinary calls without observed failures', () => {
    const breaker = new ToolStormBreaker()

    const call = { callId: 'c1', toolName: 'bash', arguments: { command: 'ls' } }
    expect(breaker.inspect(call)).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c2' })).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c3' })).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c4' })).toEqual({ suppress: false })
  })
})
