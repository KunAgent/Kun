import { describe, expect, it } from 'vitest'
import { accountModelRequest } from './request-attempt-accounting.js'
import { emptyUsageSnapshot } from '../../contracts/usage.js'
import { UsageService } from '../../services/usage-service.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

const request = (): ModelRequest => ({ model: 'route/coding', providerId: 'route-gateway:local', threadId: 'thread', turnId: 'turn',
  prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })
describe('logical model request accounting', () => {
  it('counts consumed failed attempts without inflating the successful response context', async () => {
    const first = { ...emptyUsageSnapshot(), promptTokens: 10, completionTokens: 2, totalTokens: 12 }
    const second = { ...emptyUsageSnapshot(), promptTokens: 20, completionTokens: 3, totalTokens: 23 }
    const output: ModelStreamChunk[] = []
    for await (const chunk of accountModelRequest(request(), async function* (input) {
      const abandoned = await input.attemptObserver!.begin({ providerId: 'one', model: 'model', protocol: 'responses', estimatedTokens: 20 })
      await abandoned.finish(first, true)
      const success = await input.attemptObserver!.begin({ providerId: 'two', model: 'model', protocol: 'responses', estimatedTokens: 30 })
      yield { kind: 'assistant_text_delta', text: 'ok' }
      yield { kind: 'usage', usage: second }
      await success.finish(second, true)
      yield { kind: 'completed', stopReason: 'stop' }
    })) output.push(chunk)
    const usage = output.find((chunk) => chunk.kind === 'usage')!
    if (usage.kind !== 'usage') throw new Error('Missing usage')
    expect(usage.usage.promptTokens).toBe(20)
    expect(usage.usage.attemptAccounting?.totals).toMatchObject({ promptTokens: 30, completionTokens: 5, totalTokens: 35 })
    const service = new UsageService()
    expect(service.record('thread', usage.usage).totalTokens).toBe(35)
    expect(usage.usage.attemptAccounting?.attempts).toHaveLength(2)
  })
  it('keeps a sent attempt without usage explicitly unknown and an unsent one uncharged', async () => {
    const output: ModelStreamChunk[] = []
    for await (const chunk of accountModelRequest(request(), async function* (input) {
      const unknown = await input.attemptObserver!.begin({ providerId: 'one', model: 'model', protocol: 'messages', estimatedTokens: 20 })
      await unknown.finish(undefined, true)
      const unsent = await input.attemptObserver!.begin({ providerId: 'two', model: 'model', protocol: 'messages', estimatedTokens: 20 })
      await unsent.finish(undefined, false)
      yield { kind: 'error', message: 'cancelled' }
    })) output.push(chunk)
    const usage = output.find((chunk) => chunk.kind === 'usage')!
    if (usage.kind !== 'usage') throw new Error('Missing accounting')
    expect(usage.usage.attemptAccounting).toMatchObject({ usageKnown: false, responseUsageKnown: false,
      attempts: [{ dispatched: true, usageKnown: false }, { dispatched: false, usageKnown: false }] })
  })
})
