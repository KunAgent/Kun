import { describe, expect, it } from 'vitest'
import { ContextCompactor } from '../../src/loop/context-compactor.js'
import { estimateModelRequestInputTokens } from '../../src/loop/model-request-estimator.js'
import { createThreadRecord } from '../../src/domain/thread.js'
import { makeUserItem } from '../../src/domain/item.js'
import type { ModelRequest, ModelStreamChunk } from '../../src/ports/model-client.js'
import { makeHarness } from '../loop-test-harness.js'

const CONTEXT_WINDOW_TOKENS = 1_000_000
const REQUEST_HARD_CAP_TOKENS = Math.floor(CONTEXT_WINDOW_TOKENS * 0.85)

function recordingHarness(input: { maxOutputTokens?: number; compactor: ContextCompactor }) {
  const requests: ModelRequest[] = []
  const h = makeHarness({
    provider: 'output-budget',
    model: 'output-budget',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      requests.push(request)
      yield { kind: 'completed', stopReason: 'stop' }
    }
  }, {
    tools: [],
    compactor: input.compactor,
    modelCapabilities: (model) => ({
      id: model,
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      contextWindowTokens: CONTEXT_WINDOW_TOKENS,
      ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
      messageParts: ['text']
    })
  })
  return { h, requests }
}

async function runTurnWithHistory(
  h: ReturnType<typeof makeHarness>,
  history: readonly { id: string; text: string }[]
): Promise<void> {
  await h.threadStore.upsert(
    createThreadRecord({ id: h.threadId, title: 'demo', workspace: '/tmp', model: 'output-budget' })
  )
  for (const entry of history) {
    await h.sessionStore.appendItem(h.threadId, makeUserItem({
      id: entry.id,
      turnId: `${entry.id}_turn`,
      threadId: h.threadId,
      text: entry.text
    }))
  }
  const started = await h.turns.startTurn({
    threadId: h.threadId,
    request: { prompt: 'continue' }
  })
  h.turnId = started.turnId
  await expect(h.loop.runTurn(h.threadId, h.turnId)).resolves.toBe('completed')
}

describe('AgentLoop output budget', () => {
  it('forwards a configured 128k output limit instead of the 32768 runtime default', async () => {
    const { h, requests } = recordingHarness({
      maxOutputTokens: 128_000,
      compactor: new ContextCompactor({ softThreshold: 900_000, hardThreshold: 950_000 })
    })
    await runTurnWithHistory(h, [{ id: 'small_history', text: 'hi' }])

    expect(requests).toHaveLength(1)
    const request = requests[0]!
    expect(request.maxTokens).toBe(128_000)
    expect(estimateModelRequestInputTokens(request) + request.maxTokens!)
      .toBeLessThanOrEqual(REQUEST_HARD_CAP_TOKENS)
  })

  it('clamps the forwarded limit to the remaining room under the 85% context cap', async () => {
    const { h, requests } = recordingHarness({
      maxOutputTokens: 131_072,
      compactor: new ContextCompactor({ softThreshold: 900_000, hardThreshold: 950_000 })
    })
    // ~800k estimated input stays below the soft threshold, so history is kept
    // and the declared limit no longer fits in the remaining capacity.
    await runTurnWithHistory(
      h,
      Array.from({ length: 132 }, (_, index) => ({
        id: `near_cap_${index}`,
        text: '工'.repeat(6_050)
      }))
    )

    expect(requests).toHaveLength(1)
    const request = requests[0]!
    const inputTokens = estimateModelRequestInputTokens(request)
    expect(request.maxTokens).toBe(REQUEST_HARD_CAP_TOKENS - inputTokens)
    expect(request.maxTokens).toBeLessThan(131_072)
    expect(request.maxTokens).toBeGreaterThan(32_768)
    expect(inputTokens + request.maxTokens!).toBeLessThanOrEqual(REQUEST_HARD_CAP_TOKENS)
    const events = await h.sessionStore.loadEventsSince(h.threadId, 0)
    expect(events.some((event) =>
      event.kind === 'error' && event.code === 'context_window_exceeded'
    )).toBe(false)
    expect(events.some((event) => event.kind === 'compaction_completed')).toBe(false)
  })

  it('keeps the 32768 default when the model declares no output limit', async () => {
    const { h, requests } = recordingHarness({
      compactor: new ContextCompactor({ softThreshold: 900_000, hardThreshold: 950_000 })
    })
    await runTurnWithHistory(h, [{ id: 'default_history', text: 'hi' }])

    expect(requests).toHaveLength(1)
    expect(requests[0]?.maxTokens).toBe(32_768)
  })

  it('keeps a smaller configured output limit authoritative', async () => {
    const { h, requests } = recordingHarness({
      maxOutputTokens: 8_000,
      compactor: new ContextCompactor({ softThreshold: 900_000, hardThreshold: 950_000 })
    })
    await runTurnWithHistory(h, [{ id: 'small_limit_history', text: 'hi' }])

    expect(requests).toHaveLength(1)
    expect(requests[0]?.maxTokens).toBe(8_000)
  })
})
