import { describe, expect, it } from 'vitest'
import { createThreadRecord } from '../../domain/thread.js'
import type { SessionStore } from '../../ports/session-store.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import type { ThreadService } from '../../services/thread-service.js'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'

describe('trajectory routes', () => {
  it('authenticate, isolate threads, and expose page/summary/detail DTOs', async () => {
    const recorder = new LlmDebugRecorder()
    const round = recorder.start({
      threadId: 'thread-1', turnId: 'turn-1', provider: 'test', model: 'model',
      roundId: 'round-1', step: 0, captureContent: false
    })
    const trace = recorder.beginHttpAttempt(round, {
      endpointFormat: 'chat_completions', attempt: 1, reason: 'initial',
      url: 'https://example.com/v1/chat/completions', headers: {}, bodyText: '{"private":"omitted"}'
    })
    recorder.captureChunk(round, { kind: 'completed', stopReason: 'stop' })
    await recorder.finish(round)
    const router = buildRouter(runtime(recorder))

    expect((await dispatch(router, '/v1/threads/thread-1/trajectory')).status).toBe(401)
    const page = await dispatch(router, '/v1/threads/thread-1/trajectory?filter=llm', auth())
    expect(page.status).toBe(200)
    expect(JSON.parse(page.body)).toMatchObject({ schemaVersion: 2, summary: { requestCount: 1 } })
    const summary = await dispatch(router, '/v1/threads/thread-1/trajectory/summary', auth())
    expect(JSON.parse(summary.body)).toMatchObject({ requestCount: 1, lastStatus: 'completed' })
    const detail = await dispatch(
      router,
      `/v1/threads/thread-1/trajectory/${encodeURIComponent(`request:${trace.id}`)}/detail?section=input`,
      auth()
    )
    expect(JSON.parse(detail.body)).toMatchObject({ state: 'not_captured' })
    expect((await dispatch(router, '/v1/threads/thread-2/trajectory', auth())).status).toBe(404)
  })
})

function runtime(recorder: LlmDebugRecorder): ServerRuntime {
  const thread = createThreadRecord({
    id: 'thread-1', title: 'Trace', workspace: '/tmp', model: 'model', status: 'idle'
  })
  return {
    runtimeToken: 'trace-token',
    insecure: false,
    llmDebug: recorder,
    threadService: {
      get: async (id: string) => id === thread.id ? thread : null
    } as unknown as ThreadService,
    sessionStore: { loadItems: async () => [] } as unknown as SessionStore
  } as unknown as ServerRuntime
}

function auth(): Record<string, string> {
  return { authorization: 'Bearer trace-token' }
}

async function dispatch(
  router: ReturnType<typeof buildRouter>,
  path: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: string }> {
  const request = new Request(`http://127.0.0.1${path}`, { method: 'GET', headers })
  const match = router.match('GET', new URL(request.url).pathname)
  if (!match) throw new Error(`route not found: ${path}`)
  const result = await match.handler(request, { params: match.params })
  return result instanceof Response
    ? { status: result.status, body: await result.text() }
    : { status: result.status, body: result.body }
}
