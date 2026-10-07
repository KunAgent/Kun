import { GatewayBudgetError } from '../../services/gateway-token-budget.js'
import { describe, expect, it, vi } from 'vitest'
import { observeModelAttempts } from './model-attempt-observer.js'
import { CompatModelClient } from './compat-model-client.js'
import { emptyUsageSnapshot } from '../../contracts/usage.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'

const input = (): ModelRequest => ({ model: 'model', threadId: 'thread', turnId: 'turn', prefix: [], history: [], tools: [], abortSignal: new AbortController().signal })
async function drain(stream: AsyncIterable<ModelStreamChunk>) { const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks }
describe('physical attempt accounting', () => {
  it('settles each abandoned attempt and the successful one independently before terminal output', async () => {
    const finished: Array<number | undefined> = []
    const request = { ...input(), attemptObserver: { begin: async () => ({ finish: async (usage?: ReturnType<typeof emptyUsageSnapshot>) => { finished.push(usage?.totalTokens) } }) } }
    await drain(observeModelAttempts(request, async function* (observed) {
      const metadata = { providerId: 'one', model: 'model', protocol: 'chat_completions', estimatedTokens: 10 }
      await observed.beforeWireDispatch!(metadata)
      observed.onWireDispatch?.()
      yield { kind: 'usage', usage: { ...emptyUsageSnapshot(), promptTokens: 9, totalTokens: 9 } }
      await observed.beforeWireDispatch!(metadata)
      observed.onWireDispatch?.()
      yield { kind: 'error', message: 'Disconnected' }
    }))
    expect(finished).toEqual([9, undefined])
  })
  it.each([['token_budget_exceeded', 429], ['token_budget_unbounded', 400], ['token_budget_unavailable', 503]] as const)(
    'reports %s as a local terminal failure with HTTP %s', async (code, status) => {
      let dispatched = false
      const request = { ...input(), attemptObserver: { begin: async () => { throw new GatewayBudgetError(code, 'Local budget cannot admit this attempt.') } } }
      const chunks = await drain(observeModelAttempts(request, async function* (observed) {
        await observed.beforeWireDispatch!({ providerId: 'one', model: 'model', protocol: 'responses', estimatedTokens: 10 })
        dispatched = true
        yield { kind: 'completed', stopReason: 'stop' }
      }))
      expect(dispatched).toBe(false)
      // Limit refusals point the caller at its own limit window.
      const message = `Local budget cannot admit this attempt.${status === 429 ? " See GET /v1/kun/limit for this key's limits." : ''}`
      expect(chunks).toEqual([expect.objectContaining({ code, message,
        failure: expect.objectContaining({ httpStatus: status, localAdmission: true, reason: 'request', failoverAllowed: false }) })])
    })
  it('says when a budget refusal resets, so the gateway can send retry headers', async () => {
    const endsAt = Date.parse('2026-10-08T00:00:00.000Z')
    const request = { ...input(), attemptObserver: { begin: async () => { throw new GatewayBudgetError('token_budget_exceeded', 'Budget spent.', endsAt) } } }
    const chunks = await drain(observeModelAttempts(request, async function* (observed) {
      await observed.beforeWireDispatch!({ providerId: 'one', model: 'model', protocol: 'responses', estimatedTokens: 10 })
      yield { kind: 'completed', stopReason: 'stop' }
    }))
    expect(chunks).toEqual([expect.objectContaining({
      message: "Budget spent. It resets at 2026-10-08T00:00:00.000Z. See GET /v1/kun/limit for this key's limits.",
      failure: expect.objectContaining({ httpStatus: 429, resetAt: '2026-10-08T00:00:00.000Z' }) })])
  })
  it('executes official DeepSeek FIM through the same dispatch and usage hooks', async () => {
    let body: Record<string, unknown> = {}, url = ''
    const finished = vi.fn(async () => undefined), begin = vi.fn(async () => ({ finish: finished }))
    const client = new CompatModelClient({ baseUrl: 'https://api.deepseek.com', apiKey: 'test-key', model: 'deepseek-chat',
      endpointFormat: 'chat_completions', fetchImpl: (async (target, init) => { url = String(target); body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({ choices: [{ text: 'world', finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } }), { headers: { 'content-type': 'application/json' } })
      }) as typeof fetch })
    const chunks = await drain(client.stream({ ...input(), model: 'deepseek-chat', maxTokens: 10, fim: { prompt: 'hello', suffix: '!' }, attemptObserver: { begin } }))
    expect(url).toBe('https://api.deepseek.com/beta/completions')
    expect(body).toMatchObject({ prompt: 'hello', suffix: '!', max_tokens: 10, stream: false })
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'world' })
    expect(begin).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ totalTokens: 4 }), true)
  })
})
