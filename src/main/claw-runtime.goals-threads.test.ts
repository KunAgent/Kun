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
  it('sets a Kun thread goal when the current IM thread has none', async () => {
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
          body: JSON.stringify({ goal: null })
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

    const changed = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/goal Finish document B',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(changed).toContain('Finish document B')
    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/threads/thr_goal/goal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ objective: 'Finish document B' }),
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('stops the running turn in the current IM thread', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_stop',
        conversations: [buildConversation({ localThreadId: 'thr_stop' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async (_settingsArg: AppSettingsV1, path: string, init: { method?: string; body?: string }) => {
      if (path === '/v1/threads/thr_stop' && init.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_stop',
            turns: [
              { id: 'turn_done', status: 'completed' },
              { id: 'turn_running', status: 'running' }
            ]
          })
        }
      }
      if (path === '/v1/threads/thr_stop/turns/turn_running/interrupt' && init.method === 'POST') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({ threadId: 'thr_stop', turnId: 'turn_running', status: 'aborted' })
        }
      }
      return { ok: false, status: 404, body: '{}' }
    })
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
      text: '/stop',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(reply).toContain('turn_running')
    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/threads/thr_stop/turns/turn_running/interrupt',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ discard: false }),
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('returns a Kun-prefixed error when there is no running IM turn to stop', async () => {
    const settings = buildSettings()
    settings.claw.channels = [
      buildChannel({
        threadId: 'thr_stop',
        conversations: [buildConversation({ localThreadId: 'thr_stop' })]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        id: 'thr_stop',
        turns: [{ id: 'turn_done', status: 'completed' }]
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
      text: '/stop',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(reply).toContain('[Kun]')
    expect(reply).toContain('no running task')
  })

  it('lists recent Kun threads for an incoming WeChat command', async () => {
    const settings = buildSettings()
    settings.claw.im.provider = 'weixin'
    settings.claw.im.recentThreadListLimit = 3
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
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        threads: [
          {
            id: 'thr_new',
            title: '[Claw IM:WeChat] Document B',
            status: 'idle',
            updatedAt: '2026-06-03T00:00:00.000Z'
          },
          {
            id: 'thr_old',
            title: '[Claw IM:WeChat] Document A',
            status: 'idle',
            updatedAt: '2026-06-02T00:00:00.000Z'
          },
          {
            id: 'thr_other',
            title: 'Desktop chat',
            status: 'idle',
            updatedAt: '2026-06-04T00:00:00.000Z'
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
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/list-threads',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/threads?limit=3',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('Desktop chat')
    expect(reply).toContain('Document B')
    expect(reply).toContain('Document A')
  })

  it('switches the current WeChat conversation to a selected Kun thread', async () => {
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
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        threads: [
          {
            id: 'thr_old',
            title: '[Claw IM:WeChat] Document A',
            status: 'idle',
            updatedAt: '2026-06-02T00:00:00.000Z'
          },
          {
            id: 'thr_new',
            title: '[Claw IM:WeChat] Document B',
            status: 'idle',
            updatedAt: '2026-06-03T00:00:00.000Z'
          }
        ]
      })
    }))
    const notifyChannelActivity = vi.fn()
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined,
      notifyChannelActivity
    })

    const reply = await (runtime as unknown as {
      handleIncomingImCommand: (
        settingsArg: AppSettingsV1,
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
          remoteSession: Pick<ClawImConversationV1, 'chatId' | 'senderId' | 'senderName'> & {
            messageId: string
            threadId: string
          }
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/switch 1',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0],
      remoteSession: {
        chatId: 'oc_chat_a',
        messageId: 'om_switch',
        threadId: '',
        senderId: 'ou_1',
        senderName: 'Alice'
      }
    })

    expect(reply).toContain('thr_new')
    expect(reply).toContain('also held by another IM chat')
    expect(current().claw.channels[0].threadId).toBe('thr_new')
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('thr_new')
    expect(current().claw.channels[0].conversations[0].latestMessageId).toBe('om_switch')
    expect(notifyChannelActivity).toHaveBeenCalledWith({ channelId: 'channel_1', threadId: 'thr_new' })
  })

  it('switches WeChat conversations by the number shown in the recent thread list', async () => {
    const settings = buildSettings()
    settings.claw.im.provider = 'weixin'
    settings.claw.im.recentThreadListLimit = 5
    settings.claw.channels = [
      buildChannel({
        provider: 'weixin',
        label: 'WeChat',
        threadId: 'thr_current',
        conversations: [buildConversation({ localThreadId: 'thr_current' })]
      })
    ]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        threads: [
          { id: 'thr_current', title: 'New chat', status: 'idle', updatedAt: '2026-06-05T00:00:00.000Z' },
          { id: 'thr_two', title: '你好', status: 'idle', updatedAt: '2026-06-04T00:00:00.000Z' },
          { id: 'thr_three', title: 'mock retry success', status: 'idle', updatedAt: '2026-06-03T00:00:00.000Z' },
          { id: 'thr_four', title: '触发一次后台任务，睡眠 20s', status: 'idle', updatedAt: '2026-06-02T00:00:00.000Z' },
          { id: 'thr_five', title: '创建后台休眠任务并输出字符串', status: 'idle', updatedAt: '2026-06-01T00:00:00.000Z' }
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
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/switch 4',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      settings,
      '/v1/threads?limit=5',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
    expect(reply).toContain('thr_four')
    expect(current().claw.channels[0].threadId).toBe('thr_four')
    expect(current().claw.channels[0].conversations[0].localThreadId).toBe('thr_four')
  })

  it('does not switch WeChat conversations by thread title', async () => {
    const settings = buildSettings()
    settings.claw.im.provider = 'weixin'
    settings.claw.channels = [
      buildChannel({
        provider: 'weixin',
        label: 'WeChat',
        threadId: 'thr_old',
        conversations: [buildConversation({ localThreadId: 'thr_old' })]
      })
    ]
    const { current, store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        threads: [
          {
            id: 'thr_new',
            title: '[Claw IM:WeChat] Document B',
            status: 'idle',
            updatedAt: '2026-06-03T00:00:00.000Z'
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
        input: {
          text: string
          channel: ClawImChannelV1
          conversation: ClawImConversationV1
        }
      ) => Promise<string | null>
    }).handleIncomingImCommand(settings, {
      text: '/switch Document B',
      channel: settings.claw.channels[0],
      conversation: settings.claw.channels[0].conversations[0]
    })

    expect(reply).toContain('[Kun]')
    expect(reply).toContain('Could not find')
    expect(current().claw.channels[0].threadId).toBe('thr_old')
    expect(store.patch).not.toHaveBeenCalled()
  })

  it('does not report switch success when no IM channel can persist the selection', async () => {
    const settings = buildSettings()
    const { store } = mutableSettingsStore(settings)
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        threads: [
          {
            id: 'thr_new',
            title: 'Document B',
            status: 'idle',
            updatedAt: '2026-06-03T00:00:00.000Z'
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
    }).handleIncomingImCommand(settings, { text: '/switch 1' })

    expect(reply).toContain('[Kun]')
    expect(reply).not.toContain('Switched')
    expect(store.patch).not.toHaveBeenCalled()
  })

  it('bases Feishu conversation workspaces on the configured Claw workspace', () => {
    const settings = buildSettings()
    settings.claw.im.workspaceRoot = '/tmp/claw-default'
    const channel: ClawImChannelV1 = {
      id: 'channel_1',
      provider: 'feishu' as const,
      label: 'Phone',
      enabled: true,
      model: 'auto',
      threadId: '',
      workspaceRoot: '',
      agentProfile: {
        name: 'kun',
        description: '',
        identity: '',
        personality: '',
        userContext: '',
        replyRules: ''
      },
      conversations: [],
      createdAt: '2026-06-02T00:00:00.000Z',
      updatedAt: '2026-06-02T00:00:00.000Z'
    }
    settings.claw.channels = [channel]
    const runtime = createClawRuntime({
      store: { load: vi.fn(async () => settings), patch: vi.fn(async () => settings) } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })

    const root = (runtime as unknown as {
      resolveIncomingWorkspaceRoot: (
        settingsArg: AppSettingsV1,
        channelArg: typeof channel,
        conversationArg: undefined,
        remoteSessionArg: { chatId: string; threadId: string }
      ) => string
    }).resolveIncomingWorkspaceRoot(settings, channel, undefined, {
      chatId: 'oc_chat_a',
      threadId: ''
    })

    expect(root).toBe('/tmp/claw-default/conversations/oc_chat_a')
  })

})
