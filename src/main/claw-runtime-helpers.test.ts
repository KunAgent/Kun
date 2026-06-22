import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  feishuSenderLabel,
  finalAssistantReplyText,
  imCompletionReplyForPush,
  IM_COMPLETED_NO_TEXT_REPLY,
  subscribeRuntimeThreadEvents,
  type RuntimeSseEvent,
  type ThreadDetailJson,
  type TurnItemJson
} from './claw-runtime-helpers'

// Global fetch mock for subscribeRuntimeThreadEvents
const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('finalAssistantReplyText', () => {
  it('returns the concluding text that follows the last tool activity', () => {
    const detail = singleTurnDetail([
      { kind: 'assistant_text', text: '我的计划：先读文件，再修改' },
      { kind: 'tool_call' },
      { kind: 'tool_result' },
      { kind: 'assistant_text', text: '已完成：结果是 42' }
    ])
    expect(finalAssistantReplyText(detail, { turnId: 'turn_1' })).toBe('已完成：结果是 42')
  })

  it('skips the pre-tool plan when the turn ends without concluding text', () => {
    // The exact bug: the model narrates a plan as text, performs the work
    // through tools, and stops without a final message. The plan must not
    // be mistaken for the result.
    const detail = singleTurnDetail([
      { kind: 'assistant_reasoning', text: '正在思考……' },
      { kind: 'assistant_text', text: '我的计划：先读文件，再修改' },
      { kind: 'tool_call' },
      { kind: 'tool_result' }
    ])
    expect(finalAssistantReplyText(detail, { turnId: 'turn_1' })).toBe('')
  })

  it('never treats reasoning as the reply', () => {
    const detail = singleTurnDetail([
      { kind: 'assistant_reasoning', text: '思考：结论应该是 X' },
      { kind: 'tool_call' },
      { kind: 'tool_result' },
      { kind: 'assistant_reasoning', text: '结束思考：已经完整完成 X' }
    ])
    expect(finalAssistantReplyText(detail, { turnId: 'turn_1' })).toBe('')
  })

  it('returns the last message for a pure chat turn with no tools', () => {
    const detail = singleTurnDetail([
      { kind: 'assistant_text', text: '第一段' },
      { kind: 'assistant_text', text: '最终答案' }
    ])
    expect(finalAssistantReplyText(detail, { turnId: 'turn_1' })).toBe('最终答案')
  })

  it('scopes extraction to the requested turn and ignores earlier turns', () => {
    const detail: ThreadDetailJson = {
      turns: [
        { id: 'turn_prev', status: 'completed', items: [{ kind: 'assistant_text', text: '旧回复' }] },
        { id: 'turn_cur', status: 'completed', items: [{ kind: 'tool_call' }, { kind: 'tool_result' }] }
      ]
    }
    expect(finalAssistantReplyText(detail, { turnId: 'turn_cur' })).toBe('')
    expect(finalAssistantReplyText(detail, { turnId: 'turn_prev' })).toBe('旧回复')
  })
})

describe('imCompletionReplyForPush', () => {
  it('is the plain completion note when no files were produced', () => {
    expect(imCompletionReplyForPush([])).toBe(IM_COMPLETED_NO_TEXT_REPLY)
  })

  it('lists generated file names so they can be retrieved later', () => {
    const reply = imCompletionReplyForPush([
      { path: '/w/a.md', fileName: 'a.md' },
      { path: '/w/b.png', fileName: 'b.png' }
    ])
    expect(reply).toContain('a.md')
    expect(reply).toContain('b.png')
  })
})

describe('feishuSenderLabel', () => {
  it('falls back when sender fields are missing', () => {
    expect(feishuSenderLabel({} as Parameters<typeof feishuSenderLabel>[0])).toBe('feishu-user')
  })

  it('prefers senderName over senderId', () => {
    expect(feishuSenderLabel({
      senderName: ' Alice ',
      senderId: 'ou_123'
    } as Parameters<typeof feishuSenderLabel>[0])).toBe('Alice')
  })
})

function singleTurnDetail(items: TurnItemJson[]): ThreadDetailJson {
  return { turns: [{ id: 'turn_1', status: 'completed', items }] }
}

describe('subscribeRuntimeThreadEvents', () => {
  it('opens /v1/threads/{id}/events?since_seq=0 with auth headers on first connect', async () => {
    const ac = new AbortController()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }))
    await subscribeRuntimeThreadEvents({
      baseUrl: 'http://127.0.0.1:18788',
      threadId: 'thr_1',
      headers: { Authorization: 'Bearer x' },
      onEvent: vi.fn(),
      signal: ac.signal
    })
    // First fetch should include since_seq=0
    const url = fetchMock.mock.calls[0][0] as URL
    expect(url.toString()).toContain('/v1/threads/thr_1/events')
    expect(url.searchParams.get('since_seq')).toBe('0')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ Authorization: 'Bearer x', Accept: 'text/event-stream' })
  })

  it('reconnects with exponential backoff (750ms → 5s) on 5xx', async () => {
    vi.useFakeTimers()
    try {
      const ac = new AbortController()
      // 第一次 5xx,后续提供多个 mock 让重连循环稳定跑
      fetchMock
        .mockResolvedValueOnce(new Response('', { status: 503 }))
        .mockResolvedValue(new Response('', { status: 503 }))
      const onEvent = vi.fn()
      const handle = await subscribeRuntimeThreadEvents({
        baseUrl: 'http://127.0.0.1:18788',
        threadId: 'thr_1',
        headers: {},
        onEvent,
        signal: ac.signal
      })
      // 等 750ms 后 fetch 应当被再次调用
      await vi.advanceTimersByTimeAsync(800)
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
      ac.abort()
      handle.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops reconnecting on 4xx (except 408/429)', async () => {
    const ac = new AbortController()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    await subscribeRuntimeThreadEvents({
      baseUrl: 'http://127.0.0.1:18788',
      threadId: 'thr_1',
      headers: {},
      onEvent: vi.fn(),
      signal: ac.signal,
      logError: vi.fn()
    })
    // 等 1s,确认只调一次 fetch
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
