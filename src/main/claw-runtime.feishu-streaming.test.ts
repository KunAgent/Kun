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

  it('cancels pending assistant-result polling when the Claw runtime stops', async () => {
    const settings = buildSettings()
    const runtimeRequest = vi.fn(async () => {
      throw new Error('polling should have been canceled before the request')
    })
    const runtime = createClawRuntime({
      store: {
        load: vi.fn(async () => settings),
        patch: vi.fn(async () => settings)
      } as never,
      runtimeRequest: runtimeRequest as never,
      logError: () => undefined
    })

    const pending = (runtime as unknown as {
      waitForAssistantResult: (
        settings: AppSettingsV1,
        threadId: string,
        turnId: string,
        timeoutMs: number
      ) => Promise<{ status: string; error?: string }>
    }).waitForAssistantResult(settings, 'thr_1', 'turn_1', 60_000)

    await runtime.stop()

    await expect(pending).resolves.toEqual({
      status: 'aborted',
      text: '',
      files: [],
      error: 'Claw runtime stopped.'
    })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('routes through runStreamingReply when channel.feishuStream=true', async () => {
    // Open the SSE event stream; the test will push events as the
    // streamer reads them.
    const { fetchMock, latestHandle } = stubFetchForThreadEvents()
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 5_000
    // feishuStream is per-channel (default off). Enable it on this
    // channel to exercise the streaming path.
    settings.claw.channels = [
      buildChannel({ threadId: 'thr_1', feishuStream: true, conversations: [buildConversation({ localThreadId: 'thr_1' })] })
    ]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtimeRequest = makeTurnRequest()
    const bridge = buildStreamingBridge()
    // Track the append calls the producer makes on the MarkdownStreamController.
    const appendChunks: string[] = []
    bridge.stream.mockImplementation(
      async (
        _to: string,
        input: { markdown: (controller: { append: (c: string) => Promise<void>; setContent: (s: string) => Promise<void>; messageId: string }) => Promise<void> },
        _opts?: unknown
      ) => {
        const controller = {
          messageId: 'om_stream_1',
          append: vi.fn(async (chunk: string) => {
            appendChunks.push(chunk)
          }),
          setContent: vi.fn(async (_full: string) => undefined)
        }
        // Push SSE events as soon as the streamer is subscribed.
        // Yield to the event loop so the subscriber is up first.
        setTimeout(() => {
          const h = latestHandle()
          if (!h) return
          h.emit({ seq: 1, kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: 'hello ' } })
          h.emit({ seq: 2, kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: 'streamed ' } })
          h.emit({ seq: 3, kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: 'world' } })
          h.emit({ seq: 4, kind: 'turn_completed', turnId: 'turn_1' })
        }, 0)
        await input.markdown(controller)
        return { messageId: controller.messageId }
      }
    )
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
      messageId: 'om_inbound',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'stream me',
      rawContentType: 'text',
      mentions: []
    })

    // The streaming branch was entered: the SSE event stream was opened
    // and the bridge.stream producer was invoked.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bridge.stream).toHaveBeenCalledTimes(1)
    // The three deltas came through the producer and were appended to
    // the streaming card.
    expect(appendChunks).toEqual(['hello ', 'streamed ', 'world'])
    // The streaming card is the single user-visible reply. handleFeishuMessage
    // must NOT call `bridge.send` again to deliver the streamed text as a
    // separate message — that would duplicate the reply.
    expect(bridge.send).not.toHaveBeenCalled()
  })

  it('falls back to one-shot send when bridge.stream throws', async () => {
    // Open the SSE event stream but the producer never receives any
    // useful events; bridge.stream itself rejects with `not_connected`
    // so the runStreamingReply catch arm runs and falls back to
    // bridge.send.
    stubFetchForThreadEvents()
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 5_000
    // feishuStream is per-channel; enable it so the streaming path is
    // exercised. bridge.stream will reject, triggering the in-band
    // fallback to bridge.send.
    settings.claw.channels = [
      buildChannel({ threadId: 'thr_1', feishuStream: true, conversations: [buildConversation({ localThreadId: 'thr_1' })] })
    ]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtimeRequest = makeTurnRequest()
    const bridge = buildStreamingBridge()
    // Make bridge.stream throw a not_connected error so runStreamingReply
    // catches and falls back to bridge.send.
    bridge.stream.mockRejectedValue(new Error('not_connected'))
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
      messageId: 'om_inbound_fb',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'stream then fail',
      rawContentType: 'text',
      mentions: []
    })

    expect(bridge.stream).toHaveBeenCalledTimes(1)
    // Fallback path: bridge.send is called once from runStreamingReply's
    // catch arm (the canned "Sorry" message). handleFeishuMessage must
    // NOT call bridge.send again — the in-band fallback already delivered
    // the user-visible message.
    expect(bridge.send).toHaveBeenCalledTimes(1)
    const fallbackCall = bridge.send.mock.calls.find(
      (call) => (call[1] as { markdown?: string })?.markdown === 'Sorry, I could not finish streaming the response.'
    )
    expect(fallbackCall).toBeDefined()
    expect(fallbackCall).toEqual([
      'oc_chat_a',
      { markdown: 'Sorry, I could not finish streaming the response.' },
      { replyTo: 'om_inbound_fb', replyInThread: false }
    ])
  })

  it('aborts a stalled streaming reply at the configured response timeout', async () => {
    vi.useFakeTimers()
    stubFetchForThreadEvents()
    const settings = buildSettings()
    settings.claw.im.responseTimeoutMs = 25
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const bridge = buildStreamingBridge()
    bridge.stream.mockImplementation(
      async (
        _to: string,
        input: {
          markdown: (controller: {
            append: (chunk: string) => Promise<void>
            setContent: (content: string) => Promise<void>
            messageId: string
          }) => Promise<void>
        }
      ) => {
        await input.markdown({
          messageId: 'om_stream_stalled',
          append: vi.fn(async () => undefined),
          setContent: vi.fn(async () => undefined)
        })
        return { messageId: 'om_stream_stalled' }
      }
    )
    const runtime = createClawRuntime({
      store: store as never,
      runtimeRequest: makeTurnRequest(),
      logError: () => undefined
    })

    const resultPromise = (runtime as unknown as {
      runStreamingReply: (input: {
        bridge: unknown
        chatId: string
        threadId: string
        turnId: string
        replyOptions: { replyTo?: string; replyInThread?: boolean }
        responseTimeoutMs: number
        context: Record<string, unknown>
      }) => Promise<{ ok: boolean; fellBack: boolean; message: string }>
    }).runStreamingReply({
      bridge,
      chatId: 'oc_chat_a',
      threadId: 'thr_1',
      turnId: 'turn_1',
      replyOptions: { replyTo: 'om_inbound_timeout', replyInThread: false },
      responseTimeoutMs: settings.claw.im.responseTimeoutMs,
      context: { channelId: 'channel_1' }
    })

    await vi.advanceTimersByTimeAsync(settings.claw.im.responseTimeoutMs)
    const result = await resultPromise

    expect(result).toMatchObject({ ok: true, fellBack: true, message: 'fell_back' })
    expect(bridge.send).toHaveBeenCalledWith(
      'oc_chat_a',
      { markdown: 'Sorry, I could not finish streaming the response.' },
      { replyTo: 'om_inbound_timeout', replyInThread: false }
    )
  })

  it('falls back to setContent(partial) when controller.append throws mid-stream', async () => {
    // Open the SSE event stream; the test pushes events through the
    // producer whose `append` throws, triggering the
    // setContent(accumulated) fallback inside FeishuStreamer.
    const { latestHandle } = stubFetchForThreadEvents()
    const settings = buildSettings()
    settings.claw.im.enabled = true
    settings.claw.im.responseTimeoutMs = 5_000
    // feishuStream is per-channel; enable it so the streaming path is
    // exercised. controller.append will throw, triggering the
    // setContent(accumulated) fallback inside FeishuStreamer.
    settings.claw.channels = [
      buildChannel({ threadId: 'thr_1', feishuStream: true, conversations: [buildConversation({ localThreadId: 'thr_1' })] })
    ]
    const store = {
      load: vi.fn(async () => settings),
      patch: vi.fn(async () => settings)
    }
    const runtimeRequest = makeTurnRequest()
    const bridge = buildStreamingBridge()
    let controllerRef: {
      append: ReturnType<typeof vi.fn>
      setContent: ReturnType<typeof vi.fn>
      messageId: string
    } | null = null
    bridge.stream.mockImplementation(
      async (
        _to: string,
        input: { markdown: (controller: { append: (c: string) => Promise<void>; setContent: (s: string) => Promise<void>; messageId: string }) => Promise<void> }
      ) => {
        const ctrl = {
          messageId: 'om_stream_partial',
          // append throws on every call, simulating a rate_limited
          // response from the Feishu streaming card API.
          append: vi.fn(async (_chunk: string) => {
            throw new Error('rate_limited')
          }),
          setContent: vi.fn(async (_full: string) => undefined)
        }
        controllerRef = ctrl
        // Push a single delta. The first append() call will throw,
        // the streamer will then call setContent('partial ') and
        // resolve with ok=true.
        setTimeout(() => {
          const h = latestHandle()
          if (!h) return
          h.emit({ seq: 1, kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: 'partial' } })
        }, 0)
        await input.markdown(ctrl)
        return { messageId: ctrl.messageId }
      }
    )
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
      messageId: 'om_inbound_partial',
      senderId: 'ou_1',
      senderName: 'Alice',
      chatType: 'p2p',
      mentionedBot: false,
      mentionAll: false,
      content: 'partial stream',
      rawContentType: 'text',
      mentions: []
    })

    // The producer should have called append exactly once (the very first
    // chunk, which throws 'rate_limited') and then setContent with
    // whatever text was accumulated before the throw.
    expect(controllerRef).not.toBeNull()
    expect(controllerRef!.append).toHaveBeenCalledTimes(1)
    expect(controllerRef!.setContent).toHaveBeenCalledTimes(1)
    const setContentArg = controllerRef!.setContent.mock.calls[0]?.[0] as string
    expect(typeof setContentArg).toBe('string')
    expect(setContentArg.length).toBeGreaterThan(0)
    // The partial text was finalized on the streaming card via
    // setContent. handleFeishuMessage must NOT call bridge.send again
    // — the streaming card is the only user-visible reply.
    expect(bridge.send).not.toHaveBeenCalled()
  })

})
