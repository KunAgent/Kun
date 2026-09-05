import { afterEach, describe, expect, it, vi } from 'vitest'
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
  type AppSettingsV1,
  type ModelEndpointFormat
} from '../shared/app-settings'
import { detectClawScheduledTaskRequest } from './claw-scheduled-task-detector'

function settings(endpointFormat: ModelEndpointFormat): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  provider.apiKey = 'sk-test'
  provider.baseUrl = 'https://model.example/v1'
  provider.providers[0] = {
    ...provider.providers[0],
    apiKey: 'sk-test',
    baseUrl: 'https://model.example/v1',
    endpointFormat
  }
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider,
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

describe('detectClawScheduledTaskRequest endpoint formats', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses Responses API shape for reminder extraction', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? '{}')) })
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })

    await detectClawScheduledTaskRequest(
      settings('responses'),
      'remind me tomorrow to stretch',
      'deepseek-v4-flash',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls[0]).toMatchObject({
      url: 'https://model.example/v1/responses',
      body: {
        model: 'deepseek-v4-flash',
        input: 'remind me tomorrow to stretch',
        max_output_tokens: 300,
        text: { format: { type: 'json_object' } }
      }
    })
  })

  it('uses Messages API shape and headers for reminder extraction', async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers,
        body: JSON.parse(String(init.body ?? '{}'))
      })
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"shouldCreateTask":false}' }]
      }), { status: 200 })
    })

    await detectClawScheduledTaskRequest(
      settings('messages'),
      'remind me tomorrow to stretch',
      'claude-sonnet-4-5',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls[0]).toMatchObject({
      url: 'https://model.example/v1/messages',
      body: {
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'remind me tomorrow to stretch' }],
        max_tokens: 300
      }
    })
    expect(calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer sk-test',
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01'
    })
  })

  it('uses the caller-resolved non-default provider route and credential', async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers,
        body: JSON.parse(String(init.body ?? '{}'))
      })
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: '{"shouldCreateTask":false}' }]
      }), { status: 200 })
    })
    const appSettings = settings('chat_completions')
    appSettings.provider.providers[0] = {
      ...appSettings.provider.providers[0],
      apiKey: 'sk-default',
      baseUrl: 'https://default.example/v1',
      endpointFormat: 'chat_completions'
    }
    appSettings.provider.providers.push({
      ...appSettings.provider.providers[0],
      id: 'secondary',
      name: 'Secondary Provider',
      apiKey: 'sk-secondary',
      baseUrl: 'https://secondary.example/v1',
      endpointFormat: 'messages',
      useProxy: false,
      models: ['secondary-model'],
      modelProfiles: {}
    })

    await detectClawScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      'secondary-model',
      new Date('2026-06-09T12:00:00+08:00'),
      'secondary'
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://secondary.example/v1/messages',
      body: {
        model: 'secondary-model',
        messages: [{ role: 'user', content: 'remind me tomorrow to stretch' }],
        max_tokens: 300
      }
    })
    expect(calls[0]?.headers).toMatchObject({
      Authorization: 'Bearer sk-secondary',
      'x-api-key': 'sk-secondary',
      'anthropic-version': '2023-06-01'
    })
    expect(calls[0]?.headers).not.toMatchObject({ Authorization: 'Bearer sk-default' })
  })

  it('uses the configured full endpoint URL in custom endpoint mode', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body ?? '{}')) })
      return new Response(JSON.stringify({
        output_text: '{"shouldCreateTask":false}'
      }), { status: 200 })
    })
    const appSettings = settings('custom_endpoint')
    appSettings.provider.baseUrl = 'https://gateway.example/custom-path/responses'
    appSettings.provider.providers[0] = {
      ...appSettings.provider.providers[0],
      baseUrl: 'https://gateway.example/custom-path/responses',
      endpointFormat: 'custom_endpoint'
    }

    await detectClawScheduledTaskRequest(
      appSettings,
      'remind me tomorrow to stretch',
      'custom-model',
      new Date('2026-06-09T12:00:00+08:00')
    )

    expect(calls[0]).toMatchObject({
      url: 'https://gateway.example/custom-path/responses',
      body: {
        model: 'custom-model',
        input: 'remind me tomorrow to stretch',
        max_output_tokens: 300
      }
    })
  })

  it('uses unwrapped ChatGPT OAuth and Lite input for GPT-5.6 detection', async () => {
    const calls: Array<{ headers: HeadersInit | undefined; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push({ headers: init.headers, body: JSON.parse(String(init.body ?? '{}')) })
      return new Response(JSON.stringify({ output_text: '{"shouldCreateTask":false}' }), { status: 200 })
    })
    const appSettings = settings('responses')
    const credentials = JSON.stringify({
      kind: 'codex-oauth', accessToken: 'oauth-token', refreshToken: 'refresh',
      accountId: 'account', expiresAt: Date.now() + 60_000
    })
    appSettings.provider.providers.push({
      id: 'codex', name: 'ChatGPT 订阅', apiKey: credentials,
      baseUrl: 'https://chatgpt.com/backend-api/codex', endpointFormat: 'responses',
      useProxy: false, models: ['gpt-5.6-sol'], modelProfiles: {
        'gpt-5.6-sol': {
          inputModalities: ['text', 'image'], outputModalities: ['text'], supportsToolCalling: true,
          messageParts: ['text', 'image_url'], responsesMode: 'lite'
        }
      }
    })
    appSettings.agents.kun = {
      ...appSettings.agents.kun,
      providerId: 'codex', model: 'gpt-5.6-sol', apiKey: credentials,
      baseUrl: 'https://chatgpt.com/backend-api/codex', endpointFormat: 'responses'
    }

    await detectClawScheduledTaskRequest(appSettings, 'remind me tomorrow to stretch', 'gpt-5.6-sol')

    expect(calls[0].headers).toMatchObject({
      Authorization: 'Bearer oauth-token',
      'ChatGPT-Account-Id': 'account',
      'x-openai-internal-codex-responses-lite': 'true'
    })
    expect(calls[0].body).toMatchObject({ store: false, parallel_tool_calls: false, reasoning: { context: 'all_turns' } })
    expect(calls[0].body).not.toHaveProperty('instructions')
  })
})
