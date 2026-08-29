import { describe, expect, it } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../src/ports/model-client.js'
import { modelRequestContextText } from '../src/loop/model-request-context.js'
import { bootstrapThread, makeHarness } from './loop-test-harness.js'

describe('agent loop: disableUserInput turns (IM bridges)', () => {
  it('keeps a stable catalog but tells the model not to call GUI input tools', async () => {
    let calls = 0
    const seenRequests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'im-model',
      model: 'im-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenRequests.push(request)
        calls += 1
        if (calls === 1) {
          yield {
            kind: 'tool_call_complete',
            callId: 'call_input',
            toolName: 'request_user_input',
            arguments: { prompt: 'Pick one' }
          }
          yield { kind: 'completed', stopReason: 'tool_calls' }
          return
        }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h, {
      request: { prompt: 'hi from wechat', disableUserInput: true }
    })

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    expect(seenRequests).toHaveLength(2)
    for (const request of seenRequests) {
      const advertised = request.tools.map((tool) => tool.name)
      expect(advertised).toContain('user_input')
      expect(advertised).not.toContain('request_user_input')
      expect(modelRequestContextText(request)).toMatch(/Do not call either tool/)
    }

    const result = (await h.sessionStore.loadItems(h.threadId)).find(
      (item) => item.kind === 'tool_result' && item.toolName === 'request_user_input'
    )
    expect(result).toMatchObject({ kind: 'tool_result', isError: true })

    expect(h.userInputGate.pending(h.threadId)).toHaveLength(0)
    const thread = await h.threadStore.get(h.threadId)
    const items = thread?.turns.flatMap((turn) => turn.items) ?? []
    expect(items.some((item) => item.kind === 'user_input')).toBe(false)
  })

  it('keeps GUI input tools advertised for normal turns', async () => {
    const seenRequests: ModelRequest[] = []
    const h = makeHarness({
      provider: 'gui-model',
      model: 'gui-model',
      async *stream(request: ModelRequest): AsyncIterable<ModelStreamChunk> {
        seenRequests.push(request)
        yield { kind: 'completed', stopReason: 'stop' }
      }
    })
    await bootstrapThread(h)

    const status = await h.loop.runTurn(h.threadId, h.turnId)

    expect(status).toBe('completed')
    const advertised = seenRequests[0]?.tools.map((tool) => tool.name) ?? []
    expect(advertised).toContain('user_input')
    expect(advertised).not.toContain('request_user_input')
    expect(modelRequestContextText(seenRequests[0]!)).not.toMatch(
      /Do not call either tool/
    )
  })
})
