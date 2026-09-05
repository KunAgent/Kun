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

describe('ClawRuntime handleFeishuMessage streaming', () => {
  type FeishuMessage = {
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
  }
  type LarkBridge = {
    send: ReturnType<typeof vi.fn>
    addReaction: ReturnType<typeof vi.fn>
    stream: ReturnType<typeof vi.fn>
  }

  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
  })

  // Build a fake SSE Response whose body stays open and lets the test
  // emit events on demand. Without this, the subscriber immediately sees
  // a closed stream and keeps reconnecting.
  type SseHandle = {
    emit: (event: Record<string, unknown>) => void
    close: () => void
  }
  function openSseResponse(): { response: Response; handle: SseHandle } {
    const encoder = new TextEncoder()
    let resolveNext: ((chunk: Uint8Array | null) => void) | null = null
    const handle: SseHandle = {
      emit: (event) => {
        const payload = encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        if (resolveNext) {
          const fn = resolveNext
          resolveNext = null
          fn(payload)
        } else {
          // No waiter yet; this should not happen in our test, but
          // push the payload to a small queue and let the next
          // pull drain it. For simplicity, just rely on the resolve
          // path being live when the streamer is reading.
        }
      },
      close: () => {
        if (resolveNext) {
          const fn = resolveNext
          resolveNext = null
          fn(null)
        }
      }
    }
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Eagerly enqueue an empty chunk so the reader's first read
        // resolves and we can hand control back to the event loop
        // (and eventually to the test's emit call).
        controller.enqueue(encoder.encode(': open\n\n'))
        // Park: keep the connection open. The streamer is going to
        // call reader.read() again, so we resolve a pending promise.
        const onNeedChunk = (): void => {
          if (resolveNext) {
            // already pending
            return
          }
          // We rely on the test calling `handle.emit` to feed data.
          // If the test closes, we close. If the test doesn't emit
          // anything, the read will block here — which is exactly
          // what we want.
          resolveNext = (chunk) => {
            if (chunk === null) {
              controller.close()
            } else {
              controller.enqueue(chunk)
              // Park again for the next read.
              onNeedChunk()
            }
          }
        }
        onNeedChunk()
      }
    })
    return {
      response: new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      }),
      handle
    }
  }

  function stubFetchForThreadEvents(): { fetchMock: ReturnType<typeof vi.fn>; latestHandle: () => SseHandle | null } {
    let current: SseHandle | null = null
    const fetchMock = vi.fn(async () => {
      const pair = openSseResponse()
      current = pair.handle
      return pair.response
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    return {
      fetchMock,
      latestHandle: () => current
    }
  }

  function buildStreamingBridge(): LarkBridge {
    return {
      send: vi.fn(async () => ({ messageId: 'om_send_fallback' })),
      addReaction: vi.fn(async () => 'rc_streaming_1'),
      // Default: a no-op stream. Tests override this.
      stream: vi.fn()
    }
  }

  function patchBridge(runtime: object, channelId: string, bridge: LarkBridge): void {
    ;(runtime as unknown as { feishuChannels: Map<string, LarkBridge> })
      .feishuChannels
      .set(channelId, bridge)
  }

  function makeTurnRequest(): RuntimeRequestFn {
    const request: RuntimeRequestFn = async (_settings, path) => {
      if (path === '/v1/threads/thr_1/turns') {
        return {
          ok: true,
          status: 202,
          body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' })
        }
      }
      throw new Error(`unexpected path ${path}`)
    }
    return vi.fn(request) as unknown as RuntimeRequestFn
  }

  it('does not use FeishuStreamer when channel.feishuStream is not true', async () => {
    // feishuStream is per-channel and defaults to off. The legacy
    // polling path stays in use. We do NOT open the SSE event stream
    // because the streamer is never instantiated.
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [
      buildChannel({ threadId: 'thr_1', conversations: [buildConversation({ localThreadId: 'thr_1' })] })
    ]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const agentReply = 'original polling path reply'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_1/turns') {
        return { ok: true, status: 202, body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_polling' }) }
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
                id: 'turn_polling',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: agentReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const bridge = buildStreamingBridge()
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined
    })
    patchBridge(runtime, 'channel_1', bridge)

    await (runtime as unknown as {
      handleFeishuMessage: (channelId: string, message: FeishuMessage) => Promise<void>
    }).handleFeishuMessage('channel_1', {
      chatId: 'oc_chat_a',
      messageId: 'om_inbound_no_stream',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'polling please',
      rawContentType: 'text',
      mentions: []
    })

    // FeishuStreamer / bridge.stream must NOT be invoked when the user
    // explicitly opts out of streaming.
    expect(bridge.stream).not.toHaveBeenCalled()
    // The legacy polling path delivers the reply via bridge.send.
    expect(bridge.send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: agentReply },
      { replyTo: 'om_inbound_no_stream', replyInThread: false }
    )
  })

  it('still routes through the streaming bridge for prompts that mention sending files', async () => {
    const { fetchMock, latestHandle } = stubFetchForThreadEvents()
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'deepseek-gui-feishu-stream-attachment-'))
    const filePath = join(workspaceRoot, 'stream-result.txt')
    await writeFile(filePath, 'hello from stream attachment')
    const realFilePath = await realpath(filePath)
    const settings = buildSettings()
    try {
      settings.claw.im.enabled = true
      settings.claw.im.responseTimeoutMs = 5_000
      // feishuStream is per-channel (default off). Enable it on this
      // channel so the streaming path is exercised.
      settings.claw.channels = [
        buildChannel({
          threadId: 'thr_1',
          workspaceRoot,
          feishuStream: true,
          conversations: [buildConversation({ localThreadId: 'thr_1', workspaceRoot })]
        })
      ]
      const store = {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      }
      const runtimeRequest: RuntimeRequestFn = vi.fn(async (_settings, path, init) => {
        if (path === '/v1/threads/thr_1/turns') {
          return {
            ok: true,
            status: 202,
            body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_1' })
          }
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
                  id: 'turn_1',
                  status: 'completed',
                  items: [
                    {
                      kind: 'tool_result',
                      toolName: 'send_im_attachment',
                      toolKind: 'tool_call',
                      output: {
                        files: [{
                          absolutePath: filePath,
                          relativePath: 'stream-result.txt',
                          fileName: 'stream-result.txt'
                        }],
                        status: 'queued_for_im_attachment_delivery'
                      },
                      isError: false
                    },
                    { kind: 'assistant_text', text: '好的' }
                  ]
                }
              ]
            })
          }
        }
        throw new Error(`unexpected path ${path}`)
      }) as unknown as RuntimeRequestFn
      const bridge = buildStreamingBridge()
      let streamedMessageId = ''
      bridge.stream.mockImplementation(
        async (
          _to: string,
          input: { markdown: (controller: { append: (c: string) => Promise<void>; setContent: (s: string) => Promise<void>; messageId: string }) => Promise<void> }
        ) => {
          const ctrl = {
            messageId: 'om_stream_files',
            append: vi.fn(async (_chunk: string) => undefined),
            setContent: vi.fn(async (_full: string) => undefined)
          }
          setTimeout(() => {
            const h = latestHandle()
            if (!h) return
            h.emit({ seq: 1, kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: '好的' } })
            h.emit({ seq: 2, kind: 'turn_completed', turnId: 'turn_1' })
          }, 0)
          await input.markdown(ctrl)
          streamedMessageId = ctrl.messageId
          return { messageId: ctrl.messageId }
        }
      )
      const runtime = createClawRuntime({
        store: store as never,
        runtimeRequest,
        logError: () => undefined
      })
      patchBridge(runtime, 'channel_1', bridge)

      // "生成一张图片" — shouldSendGeneratedFilesForPrompt returns true
      // without taking the direct existing-file shortcut.
      await (runtime as unknown as {
        handleFeishuMessage: (channelId: string, message: FeishuMessage) => Promise<void>
      }).handleFeishuMessage('channel_1', {
        chatId: 'oc_chat_a',
        messageId: 'om_inbound_files',
        senderId: 'ou_1',
        senderName: 'Alice',
        chatType: 'p2p',
        mentionedBot: false,
        mentionAll: false,
        content: '生成一张图片',
        rawContentType: 'text',
        mentions: []
      })

      // The streaming card was finalized (the messageId is recorded by
      // the bridge mock).
      expect(streamedMessageId).toBe('om_stream_files')
      expect(bridge.stream).toHaveBeenCalledTimes(1)
      // The SSE event stream was opened (proves the streaming branch ran
      // end-to-end without falling back to the polling path).
      expect(fetchMock).toHaveBeenCalledTimes(1)
      // Text stays in the streaming card; attachment delivery is sent as
      // a follow-up file message.
      expect(bridge.send).toHaveBeenCalledTimes(1)
      expect(bridge.send).toHaveBeenCalledWith(
        'oc_chat_a',
        { file: { source: realFilePath, fileName: 'stream-result.txt' } },
        { replyTo: 'om_inbound_files', replyInThread: false }
      )
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('does not touch FeishuStreamer for non-feishu providers (weixin unchanged)', async () => {
    // WeChat (weixin) inbound traffic arrives via handleWebhook with
    // `provider: 'weixin'` — it does NOT go through handleFeishuMessage.
    // This test exercises the webhook entry point and asserts that no
    // feishu streaming bridge is touched.
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 2_000
    settings.claw.channels = [
      buildChannel({
        provider: 'weixin' as const,
        id: 'channel_weixin',
        label: 'WeChat',
        threadId: 'thr_wx_stream',
        conversations: [
          buildConversation({
            chatId: 'wx_user_1',
            senderId: 'wx_user_1',
            localThreadId: 'thr_wx_stream'
          })
        ]
      })
    ]
    const { store } = mutableSettingsStore(settings)
    const agentReply = 'wechat reply'
    const runtimeRequest = vi.fn(async (_settings, path, init) => {
      if (path === '/v1/threads/thr_wx_stream/turns' && init?.method === 'POST') {
        return { ok: true, status: 202, body: JSON.stringify({ turnId: 'turn_wx_stream' }) }
      }
      if (path === '/v1/threads/thr_wx_stream' && init?.method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr_wx_stream',
            status: 'idle',
            turns: [
              {
                id: 'turn_wx_stream',
                status: 'completed',
                items: [{ kind: 'assistant_text', text: agentReply }]
              }
            ]
          })
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest,
      logError: () => undefined,
      createScheduledTaskFromText: vi.fn(async () => ({ kind: 'noop' as const }))
    })
    // Build a Feishu bridge entry on the same runtime to detect any
    // accidental weixin → feishu bridge reuse. The weixin webhook must
    // NOT touch it.
    const feishuBridge = buildStreamingBridge()
    patchBridge(runtime, 'channel_weixin', feishuBridge)
    const body = JSON.stringify({
      text: 'hello wechat',
      provider: 'weixin',
      channelId: 'channel_weixin',
      chatId: 'wx_user_1',
      messageId: 'wx_msg_stream',
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
    expect(parsed).toMatchObject({ ok: true, reply: agentReply })
    // No streaming bridge activity: bridge.stream and bridge.send must
    // both remain untouched for weixin (the original polling reply path
    // is what delivers the WeChat message).
    expect(feishuBridge.stream).not.toHaveBeenCalled()
    expect(feishuBridge.send).not.toHaveBeenCalled()
    expect(feishuBridge.addReaction).not.toHaveBeenCalled()
  })
})
