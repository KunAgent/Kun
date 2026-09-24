import { describe, expect, it, vi } from 'vitest'
import type { ModelRequest, ModelStreamChunk } from '../../ports/model-client.js'
import { makeGoalContextItem, makeModelContextItem, makeToolCallItem, makeToolResultItem } from '../../domain/item.js'
import { LlmDebugRecorder } from '../../services/llm-debug-recorder.js'
import { GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA } from '../tool/graph-mode-tool-provider.js'
import { GeminiCliOAuthSource, GEMINI_CLI_OAUTH_TOKEN_URL } from './gemini-cli-oauth.js'
import {
  buildGeminiCliCodeAssistRequest,
  GeminiCliApiModelClient
} from './gemini-cli-api-model-client.js'

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    threadId: 'thread-gemini',
    turnId: 'turn-gemini',
    providerId: 'gemini-cli-subscription',
    model: 'gemini-2.5-flash',
    systemPrompt: 'You are Kun.',
    prefix: [],
    history: [{
      id: 'user-1',
      turnId: 'turn-gemini',
      threadId: 'thread-gemini',
      role: 'user',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      kind: 'user_message',
      text: 'Say hello.'
    }],
    tools: [],
    abortSignal: new AbortController().signal,
    ...overrides
  }
}

async function drain(iterable: AsyncIterable<ModelStreamChunk>): Promise<ModelStreamChunk[]> {
  const chunks: ModelStreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function oauth(fetchImpl: typeof fetch): GeminiCliOAuthSource {
  return new GeminiCliOAuthSource({
    fetchImpl,
    now: () => 1_000,
    loadCredential: async () => ({
      accessToken: 'official-access-token',
      refreshToken: 'official-refresh-token',
      expiresAt: 100_000
    })
  })
}

describe('GeminiCliApiModelClient', () => {
  it('keeps private model context in chronological contents instead of systemInstruction', () => {
    const capsule = makeModelContextItem({
      id: 'context', threadId: 'thread-gemini', turnId: 'turn-gemini', stepIndex: 0,
      contentDigest: 'digest', blocks: [], text: 'Dynamic persona capsule',
      createdAt: '2026-01-01T00:00:01.000Z'
    })
    const input = request({ history: [...request().history, capsule] })
    const built = buildGeminiCliCodeAssistRequest(input, input.model, 'project') as {
      request: { systemInstruction?: unknown; contents: unknown[] }
    }
    expect(JSON.stringify(built.request.systemInstruction)).not.toContain('Dynamic persona capsule')
    expect(JSON.stringify(built.request.contents)).toContain('Dynamic persona capsule')
    expect(JSON.stringify(built.request.contents).indexOf('Say hello.'))
      .toBeLessThan(JSON.stringify(built.request.contents).indexOf('Dynamic persona capsule'))
  })

  it('preserves the minimal graph_define_plan schema in Gemini function declarations', () => {
    const input = request({
      tools: [{
        name: 'graph_define_plan',
        description: 'Define a Graph plan',
        inputSchema: GRAPH_DEFINE_PLAN_INPUT_JSON_SCHEMA
      }]
    })
    const built = buildGeminiCliCodeAssistRequest(input, input.model, 'project')
    const builtRequest = built.request as {
      tools?: Array<{
        functionDeclarations?: Array<{
          parametersJsonSchema?: unknown
        }>
      }>
    }
    const functionDeclaration = builtRequest.tools?.[0]?.functionDeclarations?.[0]
    const schema = functionDeclaration?.parametersJsonSchema as {
      properties: {
        plan: {
          properties: Record<string, unknown>
        }
      }
    }

    expect(schema.properties.plan.properties).toHaveProperty('tasks')
    expect(schema.properties.plan.properties).toHaveProperty('completionTaskKeys')
    expect(JSON.stringify(schema)).not.toContain('"budget"')
    expect(JSON.stringify(schema)).not.toContain('"model"')
    expect(JSON.stringify(schema)).not.toContain('"providerId"')
    expect(schema.properties.plan.properties).not.toHaveProperty('revision')
    expect(schema.properties.plan.properties).not.toHaveProperty('workspaceRoot')
  })

  it('streams direct Code Assist text, reasoning, tools, usage, and provider metadata', async () => {
    const requests: Array<{
      url: string
      body: Record<string, unknown>
      authorization: string
      headers: Record<string, string>
    }> = []
    const stream = [
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"thinking","thought":true},{"text":"hello "},{"functionCall":{"id":"provider-call","name":"read","args":{"path":"a.ts"}},"thoughtSignature":"signature-bytes"}]}}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":4,"thoughtsTokenCount":2,"totalTokenCount":26,"cachedContentTokenCount":15}}}\n\n',
      'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":20,"candidatesTokenCount":5,"thoughtsTokenCount":2,"totalTokenCount":27,"cachedContentTokenCount":15}}}\n\n'
    ].join('')
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      const headers = new Headers(init?.headers)
      requests.push({
        url: String(url),
        body,
        authorization: headers.get('authorization') ?? '',
        headers: Object.fromEntries(headers.entries())
      })
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          paidTier: { id: 'g1-pro-tier' },
          cloudaicompanionProject: 'managed-project'
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl)
    })

    const chunks = await drain(client.stream(request({
      tools: [{
        name: 'read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }],
      reasoningEffort: 'medium',
      maxTokens: 256
    })))

    expect(chunks).toContainEqual({ kind: 'assistant_reasoning_delta', text: 'thinking' })
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'hello ' })
    expect(chunks).toContainEqual({ kind: 'assistant_text_delta', text: 'world' })
    expect(chunks).toContainEqual({
      kind: 'tool_call_complete',
      callId: 'provider-call',
      toolName: 'read',
      arguments: { path: 'a.ts' },
      providerMetadata: { gemini: { thoughtSignature: 'signature-bytes' } }
    })
    expect(chunks).toContainEqual({
      kind: 'usage',
      usage: expect.objectContaining({
        promptTokens: 20,
        completionTokens: 5,
        reasoningTokens: 2,
        totalTokens: 27,
        cacheHitTokens: 15,
        cacheMissTokens: 5,
        actualProviderId: 'gemini-cli-subscription',
        actualModelId: 'gemini-2.5-flash'
      })
    })
    expect(chunks.at(-1)).toEqual({ kind: 'completed', stopReason: 'tool_calls' })
    expect(requests).toHaveLength(2)
    expect(requests[1]?.authorization).toBe('Bearer official-access-token')
    expect(requests[1]?.headers['user-agent']).toBe('google-gemini-cli')
    expect(requests[1]?.headers['x-goog-api-client']).toBe('gl-node/kun gemini-cli-api')
    expect(requests[1]?.url).toContain(':streamGenerateContent?alt=sse')
    expect(requests[1]?.body).toMatchObject({
      model: 'gemini-2.5-flash',
      project: 'managed-project',
      request: {
        tools: [{
          functionDeclarations: [{
            name: 'read',
            parametersJsonSchema: expect.objectContaining({ type: 'object' })
          }]
        }],
        generationConfig: {
          maxOutputTokens: 256,
          thinkingConfig: { thinkingBudget: 8_192, includeThoughts: true }
        }
      }
    })
  })

  it('replays thought signatures only in Gemini requests and redacts them from traces', async () => {
    const signature = 'opaque-thought-signature'
    const goalText = 'Keep the internal Gemini goal private.'
    const goalContext = makeGoalContextItem({
      id: 'goal-context',
      turnId: 'turn-old',
      threadId: 'thread-gemini',
      goalKey: 'goal_current',
      text: goalText
    })
    const toolCall = makeToolCallItem({
      id: 'tool-call',
      turnId: 'turn-old',
      threadId: 'thread-gemini',
      callId: 'call-old',
      toolName: 'read',
      arguments: { path: 'old.ts' },
      providerMetadata: { gemini: { thoughtSignature: signature } },
      status: 'completed'
    })
    const toolResult = makeToolResultItem({
      id: 'tool-result',
      turnId: 'turn-old',
      threadId: 'thread-gemini',
      callId: 'call-old',
      toolName: 'read',
      output: 'old contents',
      status: 'completed'
    })
    const input = request({ history: [goalContext, toolCall, toolResult] })
    const built = buildGeminiCliCodeAssistRequest(input, input.model, 'project')
    expect(JSON.stringify(built)).toContain(signature)

    let transmittedBody = ''
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      transmittedBody = String(init?.body)
      return new Response(
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"done"}]},"finishReason":"STOP"]}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const recorder = new LlmDebugRecorder()
    const client = new GeminiCliApiModelClient({
      model: input.model,
      fetchImpl,
      oauthSource: oauth(fetchImpl),
      debugSink: recorder
    })

    await drain(client.stream(input))
    const trace = (await recorder.listThread(input.threadId)).records[0]
    if (!trace?.request) throw new Error('expected a request payload in the captured trace')
    expect(transmittedBody).toContain(signature)
    expect(transmittedBody).toContain(goalText)
    expect(trace.request.body.text).not.toContain(signature)
    expect(trace.request.body.text).not.toContain(goalText)
    expect(trace.request.body.text).toContain('[REDACTED]')
    expect(trace.request.headers.values.authorization).not.toContain('official-access-token')
  })

  it('returns a conversation-safe login error instead of falling back providers', async () => {
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      oauthSource: new GeminiCliOAuthSource({
        loadCredential: async () => null
      })
    })

    expect(await drain(client.stream(request()))).toEqual([{
      kind: 'error',
      code: 'gemini_cli_login_required',
      message: expect.stringContaining('Run `gemini`')
    }])
  })

  it('classifies unavailable account models for inline conversation errors', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        error: {
          code: 404,
          status: 'NOT_FOUND',
          message: 'Requested model is unavailable for this account.'
        }
      }), {
        status: 404,
        headers: {
          'content-type': 'application/json',
          'retry-after': '30'
        }
      })
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-3.1-pro-preview',
      fetchImpl,
      oauthSource: oauth(fetchImpl)
    })

    expect(await drain(client.stream(request({
      model: 'gemini-3.1-pro-preview'
    })))).toEqual([{
      kind: 'error',
      code: 'gemini_cli_api_request_failed',
      message: expect.stringContaining('NOT_FOUND'),
      failure: {
        category: 'model_not_found',
        reason: 'model',
        responseReceived: true,
        httpStatus: 404,
        providerCode: 'NOT_FOUND',
        retryAfterMs: 30_000,
        failoverAllowed: true
      }
    }])
  })

  it('turns a provider success with no visible content into an inline error', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"MAX_TOKENS"}]}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl)
    })

    expect(await drain(client.stream(request()))).toEqual([{
      kind: 'error',
      code: 'gemini_cli_api_empty_response',
      message: expect.stringContaining('output-token budget'),
      failure: {
        category: 'unavailable',
        failoverAllowed: true
      }
    }])
  })

  it('retries transient Code Assist capacity failures before completing a tool round', async () => {
    let streamAttempts = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      streamAttempts += 1
      if (streamAttempts === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'You have exhausted your capacity. Your quota will reset after 0s.'
          }
        }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '0'
          }
        })
      }
      return new Response(
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"recovered"}]},"finishReason":"STOP"}]}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl),
      retry: {
        maxAttempts: 1,
        initialDelayMs: 0,
        httpStatusCodes: [429]
      }
    })

    expect(await drain(client.stream(request()))).toEqual([
      {
        kind: 'retrying',
        status: 429,
        attempt: 1,
        maxAttempts: 1,
        delayMs: 0,
        failureSummary: 'Gemini CLI API request failed (RESOURCE_EXHAUSTED): You have exhausted your capacity. Your quota will reset after 0s.'
      },
      { kind: 'assistant_text_delta', text: 'recovered' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    expect(streamAttempts).toBe(2)
  })

  it('retries a Code Assist fetch failure before surfacing a network error', async () => {
    let streamAttempts = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      streamAttempts += 1
      if (streamAttempts === 1) throw new TypeError('fetch failed')
      return new Response(
        'data: {"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"recovered"}]},"finishReason":"STOP"}]}}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl),
      retry: {
        maxAttempts: 1,
        initialDelayMs: 0,
        httpStatusCodes: [429, 503]
      }
    })

    expect(await drain(client.stream(request()))).toEqual([
      {
        kind: 'retrying',
        attempt: 1,
        maxAttempts: 1,
        delayMs: 0,
        reason: 'network',
        failureSummary: 'Gemini CLI API request failed: fetch failed'
      },
      { kind: 'assistant_text_delta', text: 'recovered' },
      { kind: 'completed', stopReason: 'stop' }
    ])
    expect(streamAttempts).toBe(2)
  })

  it('parses Google quota reset durations into failure metadata', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({
          currentTier: { id: 'standard-tier' },
          cloudaicompanionProject: 'project'
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'You have exhausted your capacity. Your quota will reset after 42s.'
        }
      }), { status: 429, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl),
      retry: { maxAttempts: 0 }
    })

    expect(await drain(client.stream(request()))).toEqual([expect.objectContaining({
      kind: 'error',
      code: 'rate_limit_exceeded',
      failure: expect.objectContaining({
        category: 'rate_limit',
        httpStatus: 429,
        providerCode: 'RESOURCE_EXHAUSTED',
        retryAfterMs: 42_000
      })
    })])
  })

  it('records a setup-phase trace when loadCodeAssist fails and never fabricates a model request', async () => {
    const recorder = new LlmDebugRecorder()
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({ error: { code: 403, message: 'forbidden' } }), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error('streamGenerateContent must not be reached')
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: oauth(fetchImpl),
      debugSink: recorder
    })

    const chunks = await drain(client.stream(request()))
    expect(chunks).toEqual([expect.objectContaining({
      kind: 'error',
      code: 'gemini_cli_setup_failed'
    })])
    const page = await recorder.listThread('thread-gemini')
    expect(page.records).toHaveLength(1)
    expect(page.records[0]).toMatchObject({
      phase: 'setup',
      failureOrigin: 'setup',
      diagnosticCode: 'gemini_cli_setup_failed'
    })
    expect(page.records[0]?.response?.status).toBe(403)
    expect(page.records[0]?.request).toBeDefined()
  })

  it('records a not_started credential diagnostic when no credential exists', async () => {
    const recorder = new LlmDebugRecorder()
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl: vi.fn() as unknown as typeof fetch,
      oauthSource: new GeminiCliOAuthSource({ loadCredential: async () => null }),
      debugSink: recorder
    })

    const chunks = await drain(client.stream(request()))
    expect(chunks).toEqual([expect.objectContaining({
      kind: 'error',
      code: 'gemini_cli_login_required'
    })])
    const page = await recorder.listThread('thread-gemini')
    expect(page.records).toHaveLength(1)
    expect(page.records[0]).toMatchObject({
      status: 'not_started',
      phase: 'credential',
      failureOrigin: 'credential',
      diagnosticCode: 'gemini_cli_login_required'
    })
    expect(page.records[0]?.request).toBeUndefined()
  })

  it('records a credential diagnostic when OAuth refresh fails after a 401', async () => {
    const recorder = new LlmDebugRecorder()
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith(':loadCodeAssist')) {
        return new Response(JSON.stringify({ cloudaicompanionProject: 'project' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
      if (String(url) === GEMINI_CLI_OAUTH_TOKEN_URL) {
        return new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        })
      }
      return new Response(JSON.stringify({ error: { code: 401, message: 'unauthorized' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    }) as unknown as typeof fetch
    const client = new GeminiCliApiModelClient({
      model: 'gemini-2.5-flash',
      fetchImpl,
      oauthSource: new GeminiCliOAuthSource({
        fetchImpl,
        now: () => 1_000,
        loadCredential: async () => ({
          accessToken: 'expired-token',
          refreshToken: 'refresh-token',
          expiresAt: 1_000_000
        })
      }),
      debugSink: recorder,
      retry: { maxAttempts: 0 }
    })

    const chunks = await drain(client.stream(request()))
    expect(chunks).toEqual([expect.objectContaining({
      kind: 'error',
      code: 'gemini_cli_auth_failed'
    })])
    const page = await recorder.listThread('thread-gemini')
    const diagnostics = page.records.filter((item) => item.status === 'not_started')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      phase: 'credential',
      failureOrigin: 'credential',
      diagnosticCode: 'gemini_cli_auth_failed'
    })
    // The failed model attempt itself is still captured with its HTTP 401.
    expect(page.records.some((item) => item.phase === undefined && item.response?.status === 401)).toBe(true)
  })
})
