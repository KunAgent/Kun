import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  type ClawImChannelV1,
  type ClawImConversationV1,
  type ModelProviderProfileV1
} from '../shared/app-settings'
import { createClawRuntime } from './claw-runtime'
import type { RuntimeRequestFn } from './claw-runtime-helpers'

function buildSettings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: true, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    claw: {
      ...defaultClawSettings(),
      enabled: true,
      tasks: [
        {
          id: 'task_1',
          title: 'Task 1',
          enabled: true,
          prompt: 'Summarize changes',
          workspaceRoot: '/tmp/workspace',
          clawChannelId: '',
          model: 'auto',
          reasoningEffort: 'medium',
          mode: 'agent',
          schedule: { kind: 'manual', everyMinutes: 60, timeOfDay: '09:00', atTime: '' },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z',
          lastRunAt: '',
          nextRunAt: '',
          lastStatus: 'idle',
          lastMessage: '',
          lastThreadId: ''
        }
      ]
    },
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function expectImRuntimePrompt(prompt: string | undefined, userText: string): void {
  expect(prompt).toContain('<kun_im_context>')
  expect(prompt).toContain('<interactive_gui_input_available>false</interactive_gui_input_available>')
  expect(prompt).toContain('<user_message><![CDATA[')
  expect(prompt).toContain(userText)
  expect(prompt).toContain(']]></user_message>')
}

function buildConversation(overrides: Partial<ClawImConversationV1> = {}): ClawImConversationV1 {
  return {
    id: 'conv_1',
    chatId: 'oc_chat_a',
    remoteThreadId: '',
    latestMessageId: 'om_previous',
    senderId: 'ou_1',
    senderName: 'Alice',
    localThreadId: 'thr_old',
    workspaceRoot: '/tmp/workspace/conversations/oc_chat_a',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function buildChannel(overrides: Partial<ClawImChannelV1> = {}): ClawImChannelV1 {
  return {
    id: 'channel_1',
    provider: 'feishu' as const,
    label: 'Phone',
    enabled: true,
    model: 'auto',
    threadId: 'thr_old',
    workspaceRoot: '/tmp/workspace',
    agentProfile: {
      name: 'kun',
      description: '',
      identity: '',
      personality: '',
      userContext: '',
      replyRules: ''
    },
    conversations: [],
    // Most tests model an already-greeted channel; welcome tests reset
    // this to '' to exercise the first-contact intro.
    welcomeSentAt: '2026-06-02T00:00:00.000Z',
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides
  }
}

function buildModelProvider(overrides: Partial<ModelProviderProfileV1> = {}): ModelProviderProfileV1 {
  return {
    id: 'minimax',
    name: 'MiniMax',
    apiKey: 'sk-minimax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    endpointFormat: 'messages',
    useProxy: false,
    models: ['MiniMax-M3', 'MiniMax-M2.7'],
    modelProfiles: {},
    ...overrides
  }
}

function mutableSettingsStore(initialSettings: AppSettingsV1): {
  current: () => AppSettingsV1
  store: {
    load: ReturnType<typeof vi.fn>
    patch: ReturnType<typeof vi.fn>
  }
} {
  let currentSettings = initialSettings
  const store = {
    load: vi.fn(async () => currentSettings),
    patch: vi.fn(async (partial: Partial<AppSettingsV1>) => {
      currentSettings = {
        ...currentSettings,
        ...partial,
        claw: partial.claw
          ? {
              ...currentSettings.claw,
              ...partial.claw,
              im: partial.claw.im
                ? { ...currentSettings.claw.im, ...partial.claw.im }
                : currentSettings.claw.im
            }
          : currentSettings.claw
      }
      return currentSettings
    })
  }
  return { current: () => currentSettings, store }
}

describe('ClawRuntime', () => {
  it('returns help and starts a new topic for IM commands', async () => {
    const settings = buildSettings()
    settings.claw.im.provider = 'weixin'
    settings.claw.channels = [
      buildChannel({
        provider: 'weixin',
        label: 'WeChat',
        threadId: 'thr_old',
        conversations: [
          buildConversation({ localThreadId: 'thr_old' }),
          buildConversation({ id: 'conv_2', chatId: 'oc_chat_b', localThreadId: 'thr_new' })
        ]
      })
    ]
    const { current, store } = mutableSettingsStore(settings)
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    const handle = (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand.bind(runtime)

    const help = await handle(settings, {
      text: '/help',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })
    expect(help).toContain('/list-skills')
    expect(help).toContain('/list-mcp')
    expect(help).toContain('/list-goal')
    expect(help).toContain('/goal')
    expect(help).toContain('/stop')
    expect(help).toContain('/new')

    const reply = await handle(settings, {
      text: '/new',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })
    expect(reply).toContain('new topic')
    expect(current().claw.channels[0].threadId).toBe('')
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('')
  })

  it('lists available Kun skills for an incoming IM command', async () => {
    const settings = buildSettings()
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        enabled: true,
        skills: [
          {
            id: 'documents',
            name: 'Documents',
            description: 'Create and edit documents',
            source: 'global'
          }
        ]
      })
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: { text: string }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, { text: '/list-skills' })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/skills',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('documents')
    expect(reply).toContain('Documents')
  })

  it('lists Kun MCP servers for an incoming IM command', async () => {
    const settings = buildSettings()
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        mcpServers: [
          {
            id: 'github',
            enabled: true,
            available: true,
            status: 'connected',
            transport: 'stdio',
            toolCount: 12
          },
          {
            id: 'docs',
            enabled: true,
            available: false,
            status: 'error',
            transport: 'http',
            toolCount: 0,
            lastError: 'connect failed'
          }
        ]
      })
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: { text: string }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, { text: '/list-mcp' })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/runtime/tools',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('github')
    expect(reply).toContain('12 tools')
    expect(reply).toContain('docs')
    expect(reply).toContain('connect failed')
  })

  it('shows the current Kun thread workspace for an incoming IM command', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_workspace',
        conversations: [buildConversation({ localThreadId: 'thr_workspace' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        id: 'thr_workspace',
        workspace: '/tmp/workspace/conversations/oc_chat_a',
        turns: []
      })
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/pwd',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/threads/thr_workspace',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('/tmp/workspace/conversations/oc_chat_a')
  })

  it('does not reuse the channel thread for a different incoming IM conversation', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_old_chat',
        conversations: [buildConversation({ chatId: 'oc_chat_a', localThreadId: 'thr_old_chat' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          remoteSession: Pick<ClawImConversationV1, 'chatId' | 'senderId' | 'senderName'> & {
            messageId: string
            threadId: string
          }
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/current',
      channel: settings.claw.channels[0],
      remoteSession: {
        chatId: 'oc_chat_b',
        messageId: 'om_current',
        threadId: '',
        senderId: 'ou_2',
        senderName: 'Bob'
      }
    })

    expect(reply).toContain('[Kun]')
    expect(reply).toContain('not connected')
  })

  it('shows current Kun thread token usage with provider and model for an incoming IM command', async () => {
    const settings = buildSettings()
    settings.provider.providers = [buildModelProvider()]
    settings.claw.channels = [
      buildChannel({
        providerId: 'minimax',
        model: 'MiniMax-M3',
        threadId: 'thr_usage',
        conversations: [buildConversation({ localThreadId: 'thr_usage' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        group_by: 'thread',
        buckets: [
          {
            thread_id: 'thr_usage',
            input_tokens: 123,
            output_tokens: 45,
            reasoning_tokens: 0,
            cached_tokens: 20,
            cache_miss_tokens: 105,
            total_tokens: 168,
            cost_usd: 0.00123,
            cost_cny: 0.0089,
            turns: 3,
            last_turn_cache_hit_rate: null,
            last_turn_cacheable_hit_rate: null,
            last_turn_total_input_hit_rate: null,
            last_cache_miss_reasons: [],
            last_cache_suggestions: []
          }
        ],
        totals: {
          input_tokens: 123,
          output_tokens: 45,
          reasoning_tokens: 0,
          cached_tokens: 20,
          cache_miss_tokens: 105,
          total_tokens: 168,
          cost_usd: 0.00123,
          cost_cny: 0.0089,
          cache_savings_usd: 0,
          cache_savings_cny: 0,
          token_economy_savings_tokens: 0,
          token_economy_savings_usd: 0,
          token_economy_savings_cny: 0,
          turns: 3,
          thread_count: 1,
          cache_hit_rate: null
        }
      })
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/usage',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/usage?group_by=thread&thread_id=thr_usage',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('minimax')
    expect(reply).toContain('MiniMax-M3')
    expect(reply).toContain('total 168')
    expect(reply).toContain('input 123')
    expect(reply).toContain('output 45')
  })

  it('returns a Kun-prefixed concrete error when an IM runtime command fails', async () => {
    const settings = buildSettings()
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: false,
      status: 503,
      body: JSON.stringify({ message: 'runtime is offline' })
    }))
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommandSafely: (
        settingsArg: AppSettingsV1,
        input: { text: string }
      ) => Promise<string | null>
    }).handleIncomingImCommandSafely(settings, { text: '/list-threads' })

    expect(reply).toBe('[Kun] runtime is offline')
  })

  it('prefixes successful IM slash command replies as Kun system messages', async () => {
    const settings = buildSettings()
    const { store } = mutableSettingsStore(settings)
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommandSafely: (
        settingsArg: AppSettingsV1,
        input: { text: string }
      ) => Promise<string | null>
    }).handleIncomingImCommandSafely(settings, { text: '/help' })

    expect(reply).toMatch(/^\[Kun\] /)
    expect(reply).toContain('/list-threads')
  })

  it('shows the current Kun thread goal for an IM list-goal command', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_goal',
        conversations: [buildConversation({ localThreadId: 'thr_goal' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settingsArg: AppSettingsV1, path: string, init: { method?: string; body?: string }) => {
      if (path === '/v1/threads/thr_goal/goal' && init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            goal: {
              threadId: 'thr_goal',
              objective: 'Read document A',
              status: 'active',
              tokensUsed: 12
            }
          })
        }
      }
      if (path === '/v1/threads/thr_goal/goal' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            goal: {
              threadId: 'thr_goal',
              objective: JSON.parse(init.body ?? '{}').objective,
              status: 'active',
              tokensUsed: 0
            }
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    const handle = (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand.bind(runtime)

    const shown = await handle(settings, {
      text: '/list-goal',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })
    expect(shown).toContain('Read document A')
  })

  it('rejects empty and duplicate Kun thread goals for IM commands', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_goal',
        conversations: [buildConversation({ localThreadId: 'thr_goal' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settingsArg: AppSettingsV1, path: string, init: { method?: string; body?: string }) => {
      if (path === '/v1/threads/thr_goal/goal' && init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            goal: {
              threadId: 'thr_goal',
              objective: 'Read document A',
              status: 'active',
              tokensUsed: 12
            }
          })
        }
      }
      if (path === '/v1/threads/thr_goal/goal' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            goal: {
              threadId: 'thr_goal',
              objective: JSON.parse(init.body ?? '{}').objective,
              status: 'active',
              tokensUsed: 0
            }
          })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })
    const handle = (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand.bind(runtime)

    const empty = await handle(settings, {
      text: '/goal   ',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })
    expect(empty).toContain('[Kun]')
    expect(empty).toContain('requires an objective')

    const changed = await handle(settings, {
      text: '/goal Finish document B',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })
    expect(changed).toContain('already has a goal')
    expect(changed).toContain('[Kun]')
    expect(changed).toContain('Read document A')
    expect(runtimeRequest.mock.calls.some(([, path, init]) =>
      path === '/v1/threads/thr_goal/goal' && init.method === 'POST'
    )).toBe(false)
  })

})
