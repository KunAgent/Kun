import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { randomUUID } from 'node:crypto'

export const GATEWAY_MAX_ROUTE_ATTEMPTS = 4
export const GATEWAY_REQUEST_TIMEOUT_MS = 120_000

/**
 * One wall-clock deadline covers every target and every upstream read. The
 * outer HTTP lease may expire earlier (it includes request body parsing).
 * Disable nested provider retries: the routing layer owns the total budget.
 */
export async function* withGatewayRoutingBudget(
  request: ModelRequest,
  stream: (request: ModelRequest) => AsyncIterable<ModelStreamChunk>
): AsyncIterable<ModelStreamChunk> {
  const controller = new AbortController()
  const requestId = request.requestId ?? randomUUID()
  const deadlineAt = Math.min(request.deadlineAt ?? Infinity, Date.now() + GATEWAY_REQUEST_TIMEOUT_MS)
  let timedOut = false
  const abort = () => controller.abort(request.abortSignal.reason)
  request.abortSignal.addEventListener('abort', abort, { once: true })
  if (request.abortSignal.aborted) abort()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('gateway routing deadline exceeded'))
  }, Math.max(0, deadlineAt - Date.now()))
  timer.unref?.()
  let iterator: AsyncIterator<ModelStreamChunk> | undefined
  let remainingAttempts = GATEWAY_MAX_ROUTE_ATTEMPTS
  try {
    if (deadlineAt <= Date.now()) { timedOut = true; controller.abort(new Error('gateway routing deadline exceeded')) }
    controller.signal.throwIfAborted()
    const takeAttempt = () => remainingAttempts-- > 0
    iterator = stream({ ...request, requestId, deadlineAt, abortSignal: controller.signal, maxRetryAttempts: 0,
      routingBudget: { requestId, deadlineAt, takeAttempt },
      ...(request.gatewayRouting ? { gatewayRouting: { ...request.gatewayRouting, takeAttempt } } : {})
    })[Symbol.asyncIterator]()
    while (true) {
      const next = await nextUntilAbort(iterator, controller.signal)
      if (next.done) return
      yield next.value
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error
    yield {
      kind: 'error',
      code: timedOut ? 'route_deadline_exceeded' : 'route_request_aborted',
      message: timedOut ? 'Gateway routing deadline exceeded.' : 'Gateway request aborted.',
      failure: { category: timedOut ? 'timeout' : 'request', failoverAllowed: false }
    }
  } finally {
    clearTimeout(timer)
    request.abortSignal.removeEventListener('abort', abort)
    controller.abort(new Error('gateway routing finished'))
    // A non-cooperative adapter must not keep the gateway lease alive forever.
    void iterator?.return?.().catch(() => undefined)
  }
}

function nextUntilAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return iterator.next()
    }).then((value) => { cleanup(); resolve(value) }, (error) => { cleanup(); reject(error) })
  })
}
