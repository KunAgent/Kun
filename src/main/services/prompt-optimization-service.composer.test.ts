import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPromptOptimization,
  cleanOptimizedPromptText,
  optimizePrompt,
  resolvePromptOptimizationTarget
} from './prompt-optimization-service'
import { configureRuntimeModelExecutor } from './runtime-model-requests'
import { createSettings } from './prompt-optimization-service.test-support'
import type { AppSettingsV1 } from '../../shared/app-settings'

function withOtherProviders(settings: AppSettingsV1, baseUrl = 'https://other.example/api'): AppSettingsV1 {
  settings.provider.providers.push({
    id: 'other', name: 'Other', apiKey: 'sk-other', baseUrl,
    endpointFormat: 'chat_completions', useProxy: false, models: ['other-chat', 'other-pro'], modelProfiles: {}
  }, {
    id: 'claude-login', name: 'Claude Code', kind: 'agent-sdk', apiKey: '', baseUrl: '',
    endpointFormat: 'messages', useProxy: false, models: ['sonnet'], modelProfiles: {}
  })
  return settings
}

function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
}

/** A fetch that only settles when its signal aborts, like a slow provider. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  }))
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('prompt optimization model choice', () => {
  it('uses the composer selection when Settings pins nothing', async () => {
    const fetchMock = vi.fn(async () => chatResponse('Clear prompt.'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await optimizePrompt(withOtherProviders(createSettings()), 'rough', {
      selection: { providerId: 'other', model: 'other-pro' }
    })

    expect(result).toEqual({ ok: true, text: 'Clear prompt.', model: 'other-pro', providerId: 'other' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://other.example/api/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'other-pro' })
  })

  it('maps an Auto composer model to the provider default', () => {
    const resolved = resolvePromptOptimizationTarget(withOtherProviders(createSettings()), { providerId: 'other', model: 'auto' })
    expect(resolved).toMatchObject({ ok: true, target: { source: 'composer', providerId: 'other', model: 'other-chat' } })
  })

  it('lets a model pinned in Settings win over the composer selection', () => {
    const settings = withOtherProviders(createSettings({
      promptOptimization: { enabled: true, providerId: '', model: 'deepseek-v4-flash', prompt: '', timeoutMs: 60_000 }
    }))
    const resolved = resolvePromptOptimizationTarget(settings, { providerId: 'claude-login', model: 'sonnet' })
    expect(resolved).toMatchObject({ ok: true, target: { source: 'pinned', providerId: 'deepseek', model: 'deepseek-v4-flash' } })
  })

  it.each([
    ['an external agent sign-in', { providerId: 'claude-login', model: 'sonnet' }],
    ['an unknown provider', { providerId: 'missing', model: 'x' }],
    ['a gateway binding without a provider', { providerId: '', model: 'route/coding' }]
  ])('reports %s as unsupported without sending a request', async (_label, selection) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await optimizePrompt(withOtherProviders(createSettings()), 'rough', { selection })
    expect(result).toMatchObject({ ok: false, code: 'unsupported_model' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports empty and disabled requests with codes', async () => {
    expect(await optimizePrompt(createSettings(), '   ')).toMatchObject({ ok: false, code: 'empty' })
    const disabled = createSettings({
      promptOptimization: { enabled: false, providerId: '', model: '', prompt: '', timeoutMs: 60_000, defaultsVersion: 2 }
    })
    expect(await optimizePrompt(disabled, 'rough')).toMatchObject({ ok: false, code: 'disabled' })
  })
})

describe('prompt optimization request lifecycle', () => {
  it('cancels an in-flight direct request by request id', async () => {
    const fetchMock = hangingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const pending = optimizePrompt(createSettings(), 'rough', { requestId: 'req-1' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    cancelPromptOptimization('req-1')

    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal?.aborted).toBe(true)
  })

  it('reports a timeout separately from a cancel', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', hangingFetch())
    const settings = createSettings({
      promptOptimization: { enabled: true, providerId: '', model: '', prompt: '', timeoutMs: 2_000, defaultsVersion: 2 }
    })
    const pending = optimizePrompt(settings, 'rough', { requestId: 'req-timeout' })

    await vi.advanceTimersByTimeAsync(2_000)

    expect(await pending).toMatchObject({ ok: false, code: 'timeout' })
  })

  it('passes the cancel signal to the Runtime transport and keeps it out of the request body', async () => {
    let seen: AbortSignal | undefined
    const execute = vi.fn((_input: unknown, options?: { signal?: AbortSignal }) => {
      seen = options?.signal
      return new Promise<{ ok: false; message: string }>((resolve) => {
        options?.signal?.addEventListener('abort', () => resolve({ ok: false, message: 'Model request cancelled.' }))
      })
    })
    const restore = configureRuntimeModelExecutor(execute)
    try {
      const pending = optimizePrompt(withOtherProviders(createSettings()), 'rough', {
        requestId: 'req-runtime', selection: { providerId: 'other', model: 'other-chat' }
      })
      await vi.waitFor(() => expect(execute).toHaveBeenCalled())
      cancelPromptOptimization('req-runtime')

      expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
      expect(seen?.aborted).toBe(true)
      expect(execute.mock.calls[0][0]).toMatchObject({
        purpose: 'prompt-optimization', providerId: 'other', model: 'other-chat', timeoutMs: 65_000
      })
      expect(execute.mock.calls[0][0]).not.toHaveProperty('signal')
    } finally { restore() }
  })

  it('logs routing metadata without the prompt, answer, or credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"bad key sk-other"}', { status: 401 })))
    const info = vi.fn()
    const error = vi.fn()

    const settings = withOtherProviders(createSettings(), 'https://user:pw@other.example/api?key=secret')
    const result = await optimizePrompt(settings, 'secret draft text', {
      selection: { providerId: 'other', model: 'other-chat' }, log: { info, error }
    })

    expect(result).toMatchObject({ ok: false, code: 'failed' })
    expect(error).toHaveBeenCalledWith('prompt-enhance', 'Prompt enhancement failed', expect.objectContaining({
      providerId: 'other', model: 'other-chat', endpointFormat: 'chat_completions',
      baseUrl: 'https://other.example/api', transport: 'direct'
    }))
    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls])
    expect(logged).not.toContain('secret draft text')
    expect(logged).not.toContain('pw@')
    expect(logged).not.toContain('key=secret')
  })
})

describe('cleanOptimizedPromptText', () => {
  it('unwraps a single fenced answer and leaves inner fences alone', () => {
    expect(cleanOptimizedPromptText('```markdown\nFix the login button.\n```')).toBe('Fix the login button.')
    expect(cleanOptimizedPromptText('Run:\n```sh\nnpm test\n```')).toBe('Run:\n```sh\nnpm test\n```')
  })
})
