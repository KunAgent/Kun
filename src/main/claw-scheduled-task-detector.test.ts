import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWriteSettings,
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
    uiFontScale: 'small',
    provider,
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    log: { enabled: false, retentionDays: 7 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: ''
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
})
