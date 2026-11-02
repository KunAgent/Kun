import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { interruptedStreamPartialOutput } from '../../agent/stream-interruption'
import { TimelineRuntimeError } from './MessageTimeline'

describe('interrupted stream presentation', () => {
  it('accepts only the structured interruption marker', () => {
    expect(interruptedStreamPartialOutput({ modelFailure: { responsePhase: 'interrupted', partialOutput: true } })).toBe(true)
    expect(interruptedStreamPartialOutput({ modelFailure: { responsePhase: 'interrupted', partialOutput: false } })).toBe(false)
    expect(interruptedStreamPartialOutput({ modelFailure: { partialOutput: true } })).toBeUndefined()
  })

  it('overrides the misleading legacy no-response label', async () => {
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(TimelineRuntimeError, { block: {
        kind: 'system', id: 'legacy', text: 'replay conflict', code: 'stream_replay_conflict', runtimeError: true,
        modelRequestFailure: { requestState: 'sent_no_response', providerId: 'codex', model: 'model' }
      } }))
    })
    const html = JSON.stringify(renderer.toJSON())
    expect(html).toContain('Response recovery failed')
    expect(html).toContain('Earlier output was preserved')
    expect(html).toContain('The cause of the original interruption is unknown')
    expect(html).not.toContain('No provider response')
    await act(async () => renderer.unmount())
  })

  it.each([
    { code: 'stream_disconnected', state: 'provider_responded', expected: 'Provider response' },
    { code: 'stream_disconnected', state: 'not_sent', expected: 'Request not sent' },
    { code: 'stream_replay_conflict', state: 'provider_responded', expected: 'Provider response' },
    { code: 'stream_replay_conflict', state: 'not_sent', expected: 'Request not sent' }
  ] as const)('retains $state precedence even with $code', async ({ code, state, expected }) => {
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(TimelineRuntimeError, { block: {
        kind: 'system', id: 'precedence', text: 'failure', code, runtimeError: true, streamPartialOutput: true,
        modelRequestFailure: { requestState: state, providerId: 'codex', model: 'model' }
      } }))
    })
    const html = JSON.stringify(renderer.toJSON())
    expect(html).toContain(expected)
    expect(html).not.toContain('Response recovery failed')
    expect(html).not.toContain('Response interrupted')
    await act(async () => renderer.unmount())
  })

  it('explains that delivered content was retained', async () => {
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(TimelineRuntimeError, { block: {
        kind: 'system', id: 'partial', text: 'connection ended', code: 'stream_disconnected',
        runtimeError: true, streamPartialOutput: true
      } }))
    })
    expect(JSON.stringify(renderer.toJSON())).toContain('Partial content was preserved')
    await act(async () => renderer.unmount())
  })

  it('does not claim partial content was saved when none was delivered', async () => {
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(createElement(TimelineRuntimeError, { block: {
        kind: 'system', id: 'interrupted', text: 'connection ended', code: 'stream_disconnected',
        runtimeError: true, streamPartialOutput: false
      } }))
    })
    const html = JSON.stringify(renderer.toJSON())
    expect(html).toContain('Response interrupted')
    expect(html).not.toContain('Partial content was preserved')
    await act(async () => renderer.unmount())
  })
})
