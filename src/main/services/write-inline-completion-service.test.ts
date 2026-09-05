import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { WriteInlineCompletionRequest } from '../../shared/write-inline-completion'
import {
  buildWriteInlineCompletionPrompt,
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  parseWriteInlineAction,
  requestWriteInlineCompletion
} from './write-inline-completion-service'
import { clearWriteRetrievalCache } from './write-retrieval-service'

function createSettings(patch: Partial<AppSettingsV1['write']['inlineCompletion']> = {}): AppSettingsV1 {
  const write = defaultWriteSettings()
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: 'sk-test'
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: {
      enabled: true,
      retentionDays: 2
    },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: {
      turnComplete: true
    },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: {
      ...write,
      inlineCompletion: {
        ...write.inlineCompletion,
        ...patch
      }
    },
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: {
      channel: 'stable'
    },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: [],
    claw: defaultClawSettings()
  }
}

function createRequest(): WriteInlineCompletionRequest {
  return {
    prefix: '# Draft\n\nThis is',
    suffix: ' a test.',
    currentFilePath: '/tmp/workspace/draft.md',
    cursor: {
      line: 3,
      column: 7
    },
    context: {
      language: 'markdown',
      currentLinePrefix: 'This is',
      currentLineSuffix: ' a test.',
      previousLine: '',
      previousNonEmptyLine: '# Draft',
      nextLine: '',
      indentation: '',
      signals: {
        list: false,
        quote: false,
        heading: false,
        table: false,
        atLineEnd: false,
        endsWithSentencePunctuation: false,
        previousLineEndsWithSentencePunctuation: false,
        prefersNewLineCompletion: false,
        paragraphBreakOpportunity: false
      }
    },
    policy: {
      name: 'precision-inline-v2',
      instruction: 'Return only inserted text.',
      acceptanceCriteria: ['Keep it short.'],
      rejectionCriteria: ['Do not ramble.']
    },
    preview: {
      local: 'This is',
      documentTail: '# Draft This is'
    },
    model: 'deepseek-v4-flash'
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearWriteRetrievalCache()
  clearWriteInlineCompletionDebugEntries()
})

describe('requestWriteInlineCompletion', () => {
  it('calls DeepSeek FIM completions directly instead of chat completions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' only a test' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ maxTokens: 64 }), createRequest())

    expect(result).toEqual({
      ok: true,
      completion: ' only a test',
      action: {
        kind: 'short',
        text: ' only a test'
      },
      model: 'deepseek-v4-flash',
      mode: 'short'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/beta/completions')
    expect(url).not.toContain('/chat/completions')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk-test'
    })
    const body = JSON.parse(String(init.body)) as { prompt: string; suffix: string; max_tokens: number }
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      suffix: ' a test.',
      max_tokens: 64
    })
    expect(body.prompt).toContain('Kun inline completion')
    expect(body.prompt).toContain('Return only the text to insert at the cursor')
    expect(body.prompt).not.toContain('<<<SHORT')
    expect(body.prompt).toContain('<<<PREFIX')
    expect(body.prompt).toContain('<<<SUFFIX')
    expect(body.prompt.endsWith('# Draft\n\nThis is')).toBe(true)
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: true,
      completion: ' only a test',
      mode: 'short',
      model: 'deepseek-v4-flash'
    })
  })

  it('does not route lookalike DeepSeek hosts to FIM completions', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        choices: [{
          message: {
            content: '<<<SHORT\n from chat\n>>>'
          }
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(
      createSettings({ baseUrl: 'https://deepseek.com.evil.test/beta' }),
      createRequest()
    )

    expect(result).toMatchObject({
      ok: true,
      completion: ' from chat'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://deepseek.com.evil.test/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as { messages?: unknown[]; prompt?: string }
    expect(body.messages).toBeDefined()
    expect(body.prompt).toBeUndefined()
  })

  it('does not request the API when inline completion is disabled', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestWriteInlineCompletion(createSettings({ enabled: false }), createRequest())

    expect(result).toEqual({ ok: false, message: 'Inline completion is disabled.' })
    expect(fetchMock).not.toHaveBeenCalled()
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: false,
      errorMessage: 'Inline completion is disabled.',
      completion: '',
      responseChars: 0
    })
  })

  it('records missing API key failures in the debug log', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings()
    settings.agents.kun.apiKey = ''

    const result = await requestWriteInlineCompletion(settings, createRequest())

    expect(result).toEqual({ ok: false, message: 'Missing API key for inline completion.' })
    expect(fetchMock).not.toHaveBeenCalled()
    const debugEntries = listWriteInlineCompletionDebugEntries()
    expect(debugEntries).toHaveLength(1)
    expect(debugEntries[0]).toMatchObject({
      ok: false,
      errorMessage: 'Missing API key for inline completion.',
      mode: 'short',
      suffix: ' a test.',
      responseChars: 0
    })
    expect(debugEntries[0].prompt).toContain('Kun inline completion')
    expect(debugEntries[0].prompt.endsWith('# Draft\n\nThis is')).toBe(true)
  })

  it('preserves an explicit pro completion model', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' flash text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const request = {
      ...createRequest(),
      model: 'deepseek-v4-pro'
    }
    const result = await requestWriteInlineCompletion(createSettings(), request)

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-pro'
    })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-pro'
    })
  })

  it('falls back to the General baseUrl and Kun model when write keeps defaults', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' fallback text' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings()
    settings.provider.baseUrl = 'https://general.example/v1'
    settings.agents.kun.model = 'deepseek-chat'
    settings.write.inlineCompletion.baseUrl = 'https://api.deepseek.com/beta'
    settings.write.inlineCompletion.model = 'deepseek-v4-flash'

    const result = await requestWriteInlineCompletion(settings, {
      ...createRequest(),
      model: ''
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-chat'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://general.example')
    expect(url).toContain('/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-chat'
    })
  })

  it('uses /completions as a Chat Completions-shaped custom endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: ' custom text' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings()
    settings.provider.apiKey = 'sk-custom'
    settings.provider.baseUrl = 'https://gateway.example/custom-path/completions'
    settings.provider.providers[0] = {
      ...settings.provider.providers[0],
      apiKey: 'sk-custom',
      baseUrl: 'https://gateway.example/custom-path/completions',
      endpointFormat: 'custom_endpoint'
    }

    const result = await requestWriteInlineCompletion(settings, {
      ...createRequest(),
      model: 'custom-model'
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'custom-model'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gateway.example/custom-path/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'custom-model',
      messages: expect.any(Array)
    })
  })

  it('rejects custom full endpoint URLs that do not end with a known endpoint path', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings()
    settings.provider.apiKey = 'sk-custom'
    settings.provider.baseUrl = 'https://gateway.example/custom-path'
    settings.provider.providers[0] = {
      ...settings.provider.providers[0],
      apiKey: 'sk-custom',
      baseUrl: 'https://gateway.example/custom-path',
      endpointFormat: 'custom_endpoint'
    }

    const result = await requestWriteInlineCompletion(settings, createRequest())

    expect(result).toMatchObject({
      ok: false,
      message: 'Custom full endpoint URL must end with /chat/completions, /completions, /responses, or /messages.'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses an explicit flash override when write disables model inheritance', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ text: ' explicit flash' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const settings = createSettings({
      inheritModel: false,
      model: 'deepseek-v4-flash'
    })
    settings.provider.baseUrl = 'https://general.example/v1'
    settings.agents.kun.model = 'deepseek-chat'

    const result = await requestWriteInlineCompletion(settings, {
      ...createRequest(),
      model: ''
    })

    expect(result).toMatchObject({
      ok: true,
      model: 'deepseek-v4-flash'
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('https://general.example')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-v4-flash'
    })
  })

  it('uses unwrapped ChatGPT OAuth and Responses Lite for GPT-5.6', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: ' continuation' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
    vi.stubGlobal('fetch', fetchMock)
    const settings = createSettings({ inheritProvider: false, providerId: 'codex', inheritModel: false, model: 'gpt-5.6-sol' })
    const credentials = JSON.stringify({
      kind: 'codex-oauth', accessToken: 'oauth-token', refreshToken: 'refresh',
      accountId: 'account', expiresAt: Date.now() + 60_000
    })
    settings.provider.providers.push({
      id: 'codex', name: 'ChatGPT 订阅', apiKey: credentials,
      baseUrl: 'https://chatgpt.com/backend-api/codex', endpointFormat: 'responses',
      useProxy: false, models: ['gpt-5.6-sol'], modelProfiles: {
        'gpt-5.6-sol': {
          inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true,
          messageParts: ['text', 'image_url'], responsesMode: 'lite'
        }
      }
    })

    await requestWriteInlineCompletion(settings, { ...createRequest(), model: 'gpt-5.6-sol' })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'ChatGPT-Account-Id': 'account',
      'x-openai-internal-codex-responses-lite': 'true'
    })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ store: false, parallel_tool_calls: false, reasoning: { context: 'all_turns' } })
    expect(body).not.toHaveProperty('instructions')
  })
})
