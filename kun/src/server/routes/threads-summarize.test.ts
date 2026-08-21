import { describe, expect, it } from 'vitest'
import { summarizeThread, ON_DEMAND_SESSION_SUMMARY_TIMEOUT_MS } from './threads-summarize.js'
import type { ServerRuntime } from './server-runtime.js'
import type { JsonResponse } from '../response.js'
import type { ModelClient, ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import type { TurnItem } from '../../contracts/items.js'
import { createThreadRecord } from '../../domain/thread.js'
import { makeAssistantTextItem, makeUserItem } from '../../domain/item.js'

const THREAD_ID = 'thr_summary'

function transcript(): TurnItem[] {
  return [
    makeUserItem({
      id: 'item_user',
      threadId: THREAD_ID,
      turnId: 'turn_1',
      text: 'Explain the retry policy.'
    }),
    makeAssistantTextItem({
      id: 'item_assistant',
      threadId: THREAD_ID,
      turnId: 'turn_1',
      text: 'Retries back off exponentially and stop after five attempts.'
    })
  ]
}

function runtimeWith(
  chunks: ModelStreamChunk[] | (() => AsyncIterable<ModelStreamChunk>),
  options: { items?: TurnItem[] } = {}
): { runtime: ServerRuntime; requests: ModelRequest[]; updated: { summary?: string } } {
  const requests: ModelRequest[] = []
  const updated: { summary?: string } = {}
  const record = createThreadRecord({
    id: THREAD_ID,
    title: 'Retry policy',
    workspace: '/tmp',
    model: 'deepseek-chat',
    status: 'idle'
  })
  const modelClient: ModelClient = {
    provider: 'test',
    model: 'deepseek-chat',
    stream: (request: ModelRequest) => {
      requests.push(request)
      if (typeof chunks === 'function') return chunks()
      return (async function* stream(): AsyncIterable<ModelStreamChunk> {
        for (const chunk of chunks) yield chunk
      })()
    }
  }
  const runtime = {
    modelClient,
    defaultModel: 'deepseek-chat',
    threadService: {
      get: async (id: string) => (id === THREAD_ID ? record : null),
      update: async (_id: string, patch: { summary?: string }) => {
        updated.summary = patch.summary
        return { ...record, summary: patch.summary }
      }
    },
    sessionStore: {
      loadItems: async () => options.items ?? transcript()
    }
  } as unknown as ServerRuntime
  return { runtime, requests, updated }
}

function summarizeRequest(): Request {
  return new Request('http://runtime.local/v1/threads/thr_summary/summarize', {
    method: 'POST',
    body: '{}'
  })
}

async function readBody(response: JsonResponse | Response): Promise<Record<string, unknown>> {
  if (response instanceof Response) return (await response.json()) as Record<string, unknown>
  return JSON.parse(response.body) as Record<string, unknown>
}

describe('summarizeThread failure reporting (#1200)', () => {
  it('returns the summary and the resolved role model budget on success', async () => {
    const { runtime, requests, updated } = runtimeWith([
      { kind: 'assistant_text_delta', text: 'The user asked about retries.' }
    ])

    const response = await summarizeThread(runtime, THREAD_ID, summarizeRequest())

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({
      id: THREAD_ID,
      summary: 'The user asked about retries.'
    })
    expect(updated.summary).toBe('The user asked about retries.')
    expect(requests).toHaveLength(1)
  })

  it('reports the provider failure text instead of a blanket unavailable error', async () => {
    const { runtime } = runtimeWith([
      { kind: 'error', message: 'model deepseek-chat is not available for this key', code: 'model_not_found' }
    ])

    const response = await summarizeThread(runtime, THREAD_ID, summarizeRequest())

    expect(response.status).toBe(502)
    const body = await readBody(response)
    expect(body.code).toBe('provider_unavailable')
    expect(String(body.message)).toContain('model deepseek-chat is not available for this key')
    expect(body.details).toMatchObject({ reason: 'model_error', providerCode: 'model_not_found' })
  })

  it('reports a thrown adapter failure as a provider error', async () => {
    const { runtime } = runtimeWith(() => (async function* stream(): AsyncIterable<ModelStreamChunk> {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:11434')
      // eslint-disable-next-line no-unreachable
      yield { kind: 'assistant_text_delta', text: '' }
    })())

    const response = await summarizeThread(runtime, THREAD_ID, summarizeRequest())

    expect(response.status).toBe(502)
    const body = await readBody(response)
    expect(String(body.message)).toContain('ECONNREFUSED')
  })

  it('separates an empty model answer from a missing transcript', async () => {
    const { runtime } = runtimeWith([{ kind: 'assistant_text_delta', text: '   ' }])

    const response = await summarizeThread(runtime, THREAD_ID, summarizeRequest())

    expect(response.status).toBe(503)
    const body = await readBody(response)
    expect(body.code).toBe('capability_unavailable')
    expect(body.details).toMatchObject({ reason: 'empty_output', model: 'deepseek-chat' })
  })

  it('keeps the ghost-thread case a 404 the desktop can reconcile against', async () => {
    const { runtime } = runtimeWith([])

    const response = await summarizeThread(runtime, 'thr_missing', summarizeRequest())

    expect(response.status).toBe(404)
    expect((await readBody(response)).code).toBe('not_found')
  })

  it('gives an on-demand summary a far larger budget than the background default', async () => {
    expect(ON_DEMAND_SESSION_SUMMARY_TIMEOUT_MS).toBe(90_000)
  })
})
