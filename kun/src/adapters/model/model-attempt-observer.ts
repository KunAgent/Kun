import { GatewayBudgetError } from '../../services/gateway-token-budget.js'
import type { ModelAttemptInput, ModelAttemptLease } from '../../ports/model-attempt.js'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { UsageSnapshot } from '../../contracts/usage.js'

/** Observes each physical attempt before route precommit buffering can discard its usage. */
export async function* observeModelAttempts(request: ModelRequest,
  stream: (request: ModelRequest) => AsyncIterable<ModelStreamChunk>): AsyncIterable<ModelStreamChunk> {
  if (!request.attemptObserver) { yield* stream(request); return }
  let dispatched = false
  let lease: ModelAttemptLease | undefined, usage: UsageSnapshot | undefined
  const finish = async () => { const current = lease; lease = undefined; await current?.finish(usage, dispatched); usage = undefined; dispatched = false }
  try {
    const observed = { ...request, onWireDispatch: () => { dispatched = true; request.onWireDispatch?.() }, beforeWireDispatch: async (input: ModelAttemptInput) => {
      await finish()
      lease = await request.attemptObserver!.begin(input)
    } }
    for await (const chunk of stream(observed)) {
      if (chunk.kind === 'usage') usage = chunk.usage
      // Settlement precedes terminal output, including when consumers stop at completed.
      if (chunk.kind === 'completed' || chunk.kind === 'error') await finish()
      yield chunk
    }
  } catch (error) {
    if (!(error instanceof GatewayBudgetError)) throw error
    yield { kind: 'error', code: error.code, message: 'Gateway budget settlement is pending.',
      failure: { category: 'request', httpStatus: 503, failoverAllowed: false } }
  } finally { await finish() }
}
