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
  it('sends send_im_attachment tool output to Feishu as an attachment', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-im-attachment-'))
    const filePath = join(workspaceRoot, 'out.txt')
    await writeFile(filePath, 'hello from im tool')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.claw.channels = [
        buildChannel({
          threadId: 'thr_1',
          workspaceRoot,
          conversations: [buildConversation({ localThreadId: 'thr_1', workspaceRoot })]
        })
      ]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1/turns') {
          const body = JSON.parse(init?.body ?? '{}') as { imContext?: boolean }
          expect(body.imContext).toBe(true)
          return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_attachment' }) }
        }
        if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_attachment',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'send_im_attachment',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: filePath,
                          relativePath: 'out.txt',
                          fileName: 'out.txt'
                        }],
                        status: 'queued_for_im_attachment_delivery'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '已经准备好。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_attachment_1')
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: {
          chatId: string
          messageId: string
          threadId?: string
          senderId: string
          senderName?: string
          chatType: 'p2p' | 'group'
          mentionedBot: boolean
          mentionAll: boolean
          content: string
          rawContentType: string
          mentions: unknown[]
        }) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound_attachment',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '请继续',
        rawContentType: 'text',
        mentions: []
      })

      expect(send).toHaveBeenNthCalledWith(
        1,
        'oc_chat_a',
        { markdown: '已经准备好。' },
        { replyTo: 'om_inbound_attachment', replyInThread: false }
      )
      expect(send).toHaveBeenNthCalledWith(
        2,
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'out.txt' } },
        { replyTo: 'om_inbound_attachment', replyInThread: false }
      )
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('pushes delayed send_im_attachment tool output to Feishu', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-delayed-attachment-'))
    const filePath = join(workspaceRoot, 'delayed.txt')
    await writeFile(filePath, 'hello from delayed im tool')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.channels = [
        buildChannel({
          threadId: 'thr_1',
          workspaceRoot,
          conversations: [buildConversation({ localThreadId: 'thr_1', workspaceRoot })]
        })
      ]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_1',
              status: 'idle',
              turns: [
                {
                  id: 'turn_delayed_attachment',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'send_im_attachment',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: filePath,
                          relativePath: 'delayed.txt',
                          fileName: 'delayed.txt'
                        }],
                        status: 'queued_for_im_attachment_delivery'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '已经准备好。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const send = vi.fn(async () => ({ messageId: 'om_sent' }))
      const addReaction = vi.fn(async () => 'rc_attachment_1')
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      ;(runtime as unknown as { feishuChannels: Map<string, { send: typeof send, addReaction: typeof addReaction }> })
        .feishuChannels
        .set('channel_1', { send, addReaction })

      ;(runtime as unknown as {
        scheduleImResultPush: (
          settings: AppSettingsV1,
          input: {
            channel: AppSettingsV1['claw']['channels'][number]
            remoteSession: {
              chatId: string
              messageId: string
              threadId: string
              senderId: string
              senderName: string
            }
            threadId: string
            turnId: string
            workspaceRoot: string
          }
        ) => void
      }).scheduleImResultPush(settings, {
        channel: settings.claw.channels[0],
        remoteSession: {
          chatId: 'oc_chat_a',
          messageId: 'om_inbound_delayed_attachment',
          threadId: '',
          senderId: 'ou_1',
          senderName: 'Alice'
        },
        threadId: 'thr_1',
        turnId: 'turn_delayed_attachment',
        workspaceRoot
      })

      await vi.waitFor(
        () => expect(send).toHaveBeenCalledWith(
          'oc_chat_a',
          { file: { source: realFilePath, fileName: 'delayed.txt' } },
          {}
        ),
        { timeout: 8_000, interval: 100 }
      )
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns generated files in the WeChat webhook reply for image requests', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-image-'))
    const imageDir = join(workspaceRoot, '.deepseekgui-images')
    const imagePath = join(imageDir, 'img-20260611000200-beef.png')
    await mkdir(imageDir, { recursive: true })
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const realImagePath = await realpath(imagePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.agents.kun.imageGeneration = {
        enabled: true,
        providerId: '',
        protocol: 'openai-images',
        baseUrl: 'https://images.example.test/v1',
        apiKey: 'sk-image',
        model: 'test-image-model',
        defaultResolution: '1K',
        defaultSize: '1024x1024',
        quality: 'auto',
        timeoutMs: 180000
      }
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx',
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { prompt?: string }
          expectImRuntimePrompt(body.prompt, '帮我画一张猫的图片')
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_img' }) }
        }
        if (path === '/v1/threads/thr_wx' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_img',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'generate_image',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: imagePath,
                          relativePath: '.deepseekgui-images/img-20260611000200-beef.png',
                          mimeType: 'image/png'
                        }],
                        endpoint: 'generations'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '图片已生成。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '帮我画一张猫的图片',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_img',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '图片已生成。' })
      expect(parsed.files).toEqual([
        {
          path: realImagePath,
          relativePath: '.deepseekgui-images/img-20260611000200-beef.png',
          fileName: 'img-20260611000200-beef.png'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns send_im_attachment tool output in the WeChat webhook reply', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-weixin-im-attachment-'))
    const filePath = join(workspaceRoot, 'report.md')
    await writeFile(filePath, '# Report\n')
    const realFilePath = await realpath(filePath)
    try {
      const settings = buildSettings()
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 2_000
      settings.claw.channels = [
        buildChannel({
          provider: 'weixin' as const,
          id: 'channel_weixin',
          label: 'WeChat',
          threadId: 'thr_wx',
          workspaceRoot,
          conversations: [
            buildConversation({
              chatId: 'wx_user_1',
              senderId: 'wx_user_1',
              localThreadId: 'thr_wx',
              workspaceRoot
            })
          ]
        })
      ]
      const { store } = mutableSettingsStore(settings)
      const runtimeRequest = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_wx/turns' && init?.method === 'POST') {
          const body = JSON.parse(init?.body ?? '{}') as { imContext?: boolean }
          expect(body.imContext).toBe(true)
          return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_attachment' }) }
        }
        if (path === '/v1/threads/thr_wx' && init?.method === 'GET') {
          return {
            ok: true,
            status: 200,
            body: JSON.stringify({
              id: 'thr_wx',
              status: 'idle',
              turns: [
                {
                  id: 'turn_wx_attachment',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'send_im_attachment',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: filePath,
                          relativePath: 'report.md',
                          fileName: 'report.md'
                        }],
                        status: 'queued_for_im_attachment_delivery'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '报告准备好了。' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      })
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest: runtimeRequest as never,
        logError: () => undefined,
        createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
      })
      const body = JSON.stringify({
        text: '请继续',
        provider: 'weixin',
        channelId: 'channel_weixin',
        chatId: 'wx_user_1',
        messageId: 'wx_msg_attachment',
        senderId: 'wx_user_1',
        senderName: 'Alice'
      })
      const req = {
        method: 'POST',
        url: settings.claw.im.path,
        headers: {},
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(body)
        }
      }
      let status = 0
      let responseBody = ''
      const res = {
        writeHead: vi.fn((nextStatus: number) => {
          status = nextStatus
        }),
        end: vi.fn((payload: string) => {
          responseBody = payload
        })
      }

      await (runtime as unknown as {
        handleWebhook: (request: typeof req, response: typeof res) => Promise<void>
      }).handleWebhook(req, res)

      expect(status).toBe(200)
      const parsed = JSON.parse(responseBody)
      expect(parsed).toMatchObject({ ok: true, reply: '报告准备好了。' })
      expect(parsed.files).toEqual([
        {
          path: realFilePath,
          relativePath: 'report.md',
          fileName: 'report.md'
        }
      ])
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

})
