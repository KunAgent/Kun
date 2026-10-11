import type { ModelStreamChunk } from '../../ports/model-client.js'

export type GatewayStreamEnd = 'completed' | 'failed' | 'cancelled'

/**
 * Observes a model stream without changing its iterator semantics. An async
 * generator wrapper would queue `return()` behind a pending `next()`, so a
 * cancelled client could not abort an upstream that ignores its signal; this
 * tap forwards `return()` immediately instead.
 */
export function tapGatewayStream(
  source: AsyncIterable<ModelStreamChunk>,
  observe: (chunk: ModelStreamChunk) => void,
  end?: (outcome: GatewayStreamEnd) => void
): AsyncIterable<ModelStreamChunk> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]()
      let outcome: GatewayStreamEnd = 'cancelled'
      let ended = false
      const settle = (value: GatewayStreamEnd): void => {
        if (ended) return
        ended = true
        end?.(value)
      }
      return {
        async next() {
          let result: IteratorResult<ModelStreamChunk>
          try {
            result = await iterator.next()
          } catch (error) {
            settle('failed')
            throw error
          }
          if (result.done) {
            settle(outcome)
            return result
          }
          const chunk = result.value
          if (chunk.kind === 'completed') outcome = chunk.stopReason === 'error' ? 'failed' : 'completed'
          if (chunk.kind === 'error') outcome = 'failed'
          try { observe(chunk) } catch { /* Observation never breaks the stream. */ }
          if (chunk.kind === 'completed' || chunk.kind === 'error') settle(outcome)
          return result
        },
        async return(value?: unknown) {
          settle(outcome === 'completed' ? 'completed' : 'cancelled')
          return iterator.return ? iterator.return(value) : { done: true, value: undefined }
        },
        async throw(error?: unknown) {
          settle('failed')
          if (iterator.throw) return iterator.throw(error)
          throw error
        }
      }
    }
  }
}
