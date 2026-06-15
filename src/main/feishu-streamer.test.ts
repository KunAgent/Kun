import { describe, expect, it, vi } from 'vitest'
import type { LarkChannel, MarkdownStreamController, SendOptions, SendResult } from '@larksuiteoapi/node-sdk'
import { FeishuStreamer, type SseSubscriber } from './feishu-streamer'

type StreamInput = { markdown: (controller: MarkdownStreamController) => Promise<void> }

function makeBridge(): {
  bridge: LarkChannel
  controller: MarkdownStreamController
  messageId: string
} {
  const messageId = 'om_stream_1'
  const controller: MarkdownStreamController = {
    append: vi.fn(async () => undefined),
    setContent: vi.fn(async () => undefined),
    get messageId() { return messageId }
  }
  const bridge = {
    // Critical: use stream, not send
    stream: vi.fn(async (_to: string, input: StreamInput, _opts: SendOptions): Promise<SendResult> => {
      await input.markdown(controller)
      return { messageId }
    })
  } as unknown as LarkChannel
  return { bridge, controller, messageId }
}

function makeSubscriber(
  events: Array<Record<string, unknown>>,
  onEvent: (event: Record<string, unknown>) => void
): { subscribe: SseSubscriber; delivered: () => Array<Record<string, unknown>> } {
  const delivered: Array<Record<string, unknown>> = []
  let closed = false
  const subscribe: SseSubscriber = (signal) => {
    const onAbort = (): void => { closed = true }
    signal.addEventListener('abort', onAbort, { once: true })
    queueMicrotask(() => {
      for (const event of events) {
        if (closed) return
        delivered.push(event)
        onEvent(event)
      }
    })
    return { close: (): void => { closed = true } }
  }
  return { subscribe, delivered: () => delivered }
}

describe('FeishuStreamer', () => {
  it('streams assistant_text_delta in order, calls setContent once on turn_completed, resolves with messageId', async () => {
    const { bridge, controller, messageId } = makeBridge()
    const streamer = new FeishuStreamer({
      bridge, chatId: 'oc_chat_1', turnId: 'turn_1', threadId: 'thr_1',
      replyOptions: { replyTo: 'om_in_1' }, logger: vi.fn()
    })
    const sub = makeSubscriber(
      [
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: '你' } },
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: '好' } },
        { kind: 'assistant_text_delta', turnId: 'turn_1', item: { text: '!' } },
        { kind: 'turn_completed', turnId: 'turn_1' }
      ],
      (event) => streamer.onSseEvent(event)
    )

    const result = await streamer.start({ subscribe: sub.subscribe })

    expect(controller.append).toHaveBeenCalledTimes(3)
    expect(controller.append).toHaveBeenNthCalledWith(1, '你')
    expect(controller.append).toHaveBeenNthCalledWith(2, '好')
    expect(controller.append).toHaveBeenNthCalledWith(3, '!')
    expect(controller.setContent).toHaveBeenCalledTimes(1)
    expect(controller.setContent).toHaveBeenCalledWith('你好!')
    expect(result).toEqual({ ok: true, messageId, finalText: '你好!', fellBack: false })
  })
})
