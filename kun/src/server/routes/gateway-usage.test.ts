import { describe, expect, it, vi } from 'vitest'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import type { GatewayUsageRecorder } from '../../services/gateway-usage-service.js'
import { wrapGatewayUsage } from './gateway-usage.js'

function recorder(): GatewayUsageRecorder {
  return { attribution: { threadId: 'audit', turnId: 'request' }, observe: vi.fn(), finish: vi.fn(async () => undefined) }
}

async function* chunks(...values: ModelStreamChunk[]): AsyncIterable<ModelStreamChunk> { yield* values }

describe('gateway usage stream lifetime', () => {
  it('waits for serializer validation before success and settles exactly once', async () => {
    const usage = recorder()
    const stream = wrapGatewayUsage(chunks({ kind: 'assistant_text_delta', text: 'private' }, { kind: 'completed', stopReason: 'stop' }), usage)
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    expect(usage.finish).not.toHaveBeenCalled()
    expect(await iterator.next()).toMatchObject({ value: { kind: 'completed' } })
    expect(usage.finish).not.toHaveBeenCalled()
    await stream.finish('completed')
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('completed')
    await iterator.return?.()
    expect(usage.finish).toHaveBeenCalledTimes(1)
    expect(usage.observe).toHaveBeenCalledTimes(2)
  })

  it('records post-completion serializer rejection as failed rather than success or cancellation', async () => {
    const usage = recorder()
    const stream = wrapGatewayUsage(chunks({ kind: 'completed', stopReason: 'tool_calls' }), usage)
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    await stream.finish('failed')
    await iterator.return?.()
    await stream.finish('completed')
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failed')
  })

  it('records pre-completion serializer rejection as failed before cleanup', async () => {
    const usage = recorder()
    const stream = wrapGatewayUsage(chunks({ kind: 'image_generation_complete', imageBase64: 'private', mimeType: 'image/png' }), usage)
    const iterator = stream[Symbol.asyncIterator]()
    await iterator.next()
    await stream.finish('failed')
    await iterator.return?.()
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failed')
  })

  it('settles cancellation while an upstream ignores both abort and return', async () => {
    const usage = recorder()
    const upstream = {
      [Symbol.asyncIterator]() { return this },
      next: vi.fn(() => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined)),
      return: () => new Promise<IteratorResult<ModelStreamChunk>>(() => undefined)
    }
    const iterator = wrapGatewayUsage(upstream, usage)[Symbol.asyncIterator]()
    const pending = iterator.next()
    await Promise.resolve()
    expect(upstream.next).toHaveBeenCalledTimes(1)
    await expect(iterator.return?.()).resolves.toMatchObject({ done: true })
    await expect(pending).resolves.toMatchObject({ done: true })
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('cancelled')
  })

  it('marks upstream errors, thrown errors and incomplete exhaustion as failures', async () => {
    for (const upstream of [
      chunks({ kind: 'error', message: 'upstream failed' }),
      chunks({ kind: 'completed', stopReason: 'error' }),
      chunks({ kind: 'assistant_text_delta', text: 'partial' }),
      { [Symbol.asyncIterator](): AsyncIterator<ModelStreamChunk> { return { next: async () => { throw new Error('failed') } } } }
    ]) {
      const usage = recorder()
      try { for await (const _chunk of wrapGatewayUsage(upstream, usage)) { /* Drain. */ } } catch { /* Expected upstream throw. */ }
      expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failed')
    }
  })

  it('records deadline cancellation as failed while ordinary disconnects remain cancelled', async () => {
    const usage = recorder()
    const iterator = wrapGatewayUsage(chunks({ kind: 'assistant_text_delta', text: 'partial' }), usage, { timedOut: () => true })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failed')
  })

  it('distinguishes a request-signal disconnect from a timeout in serializer error settlement', async () => {
    const usage = recorder()
    const stream = wrapGatewayUsage(chunks(), usage, { cancelled: () => true, timedOut: () => false })
    await stream.finish('failed')
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('cancelled')
    const timedOut = recorder()
    await wrapGatewayUsage(chunks(), timedOut, { cancelled: () => true, timedOut: () => true }).finish('failed')
    expect(timedOut.finish).toHaveBeenCalledExactlyOnceWith('failed')
  })

  it('does not convert a persistence failure after a terminal chunk into a success', async () => {
    const usage = recorder()
    usage.finish = vi.fn(async () => { throw new Error('ledger unavailable') })
    const stream = wrapGatewayUsage(chunks({ kind: 'completed', stopReason: 'stop' }), usage)
    await stream[Symbol.asyncIterator]().next()
    await expect(stream.finish('completed')).rejects.toThrow('Gateway usage storage is unavailable.')
  })
})
