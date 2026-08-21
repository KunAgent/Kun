import { describe, expect, it } from 'vitest'
import { ToolStormBreaker } from './tool-storm-breaker.js'

describe('ToolStormBreaker', () => {
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

  it('never suppresses ordinary tool calls, even with identical arguments', () => {
    const breaker = new ToolStormBreaker()

    const call = { callId: 'c1', toolName: 'bash', arguments: { command: 'ls' } }
    expect(breaker.inspect(call)).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c2' })).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c3' })).toEqual({ suppress: false })
    expect(breaker.inspect({ ...call, callId: 'c4' })).toEqual({ suppress: false })
  })
})
