import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from '../../agent/kun-contract-runtime'
import { presentRoomRunItems, roomUserDisplayText } from './room-run-presentation'

function item(kind: string, extra: Partial<CoreTurnItemJson> = {}): CoreTurnItemJson {
  return {
    id: `${kind}_${Math.random().toString(36).slice(2, 8)}`,
    threadId: 'thread',
    role: 'assistant',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    kind,
    ...extra
  } as CoreTurnItemJson
}

const envelope = [
  'Earlier public conversation (reference only, not new authorization):\n[{"author":"小 Kun","status":"final","text":"你好"}]',
  'User message:\n磁盘还有多少空间？',
  'User supplied content references: [{"id":"r1"}]'
].join('\n\n')

describe('roomUserDisplayText', () => {
  it('extracts the real message body from the prompt envelope', () => {
    expect(roomUserDisplayText(envelope)).toBe('磁盘还有多少空间？')
  })

  it('keeps trailing sections out of the display text', () => {
    const withHandoff = `${envelope}\n\nThis is the result of your scoped collaboration. Use it to continue.`
    expect(roomUserDisplayText(withHandoff)).toBe('磁盘还有多少空间？')
  })

  it('returns empty for plain prompts without the marker', () => {
    expect(roomUserDisplayText('just a normal prompt')).toBe('')
  })

  it('preserves paragraphs inside the user body', () => {
    const body = 'first paragraph\n\nsecond paragraph'
    expect(roomUserDisplayText(`User message:\n${body}`)).toBe(body)
  })
})

describe('presentRoomRunItems', () => {
  it('adds displayText to envelope user messages and leaves real displayText alone', () => {
    const [presented] = presentRoomRunItems([item('user_message', { role: 'user', text: envelope })])
    expect(presented.displayText).toBe('磁盘还有多少空间？')
    expect(presented.text).toBe(envelope)
    const untouched = item('user_message', { role: 'user', text: 'raw', displayText: 'shown' })
    expect(presentRoomRunItems([untouched])[0]).toBe(untouched)
  })

  it('surfaces a completed send_im_message call as an assistant bubble and drops its result', () => {
    const call = item('tool_call', {
      toolName: 'send_im_message',
      callId: 'c1',
      arguments: { text: '清理完成。', attachments: [{ path: '/w/report.pdf', fileName: 'report.pdf' }] }
    })
    const result = item('tool_result', { toolName: 'send_im_message', callId: 'c1', output: { ok: true } })
    const [presented] = presentRoomRunItems([call, result])
    expect(presented.kind).toBe('assistant_text')
    expect(presented.text).toBe('清理完成。\n[report.pdf]')
    expect(presented.toolName).toBeUndefined()
    expect(presentRoomRunItems([call, result])).toHaveLength(1)
  })

  it('keeps failed or unsettled send_im_message calls as tool cards', () => {
    const call = item('tool_call', { toolName: 'send_im_message', callId: 'c2', arguments: { text: 'hi' } })
    const failed = item('tool_result', { toolName: 'send_im_message', callId: 'c2', isError: true })
    expect(presentRoomRunItems([call, failed]).map((entry) => entry.kind)).toEqual(['tool_call', 'tool_result'])
    const pending = item('tool_call', { toolName: 'send_im_message', callId: 'c3', arguments: { text: 'hi' } })
    expect(presentRoomRunItems([pending])).toEqual([pending])
  })

  it('unwraps legacy decision-envelope assistant text', () => {
    const legacy = item('assistant_text', {
      text: '[{"author":"bot","status":"final","text":"第一句"},{"author":"bot","status":"final","text":"第二句"}]'
    })
    expect(presentRoomRunItems([legacy])[0].text).toBe('第一句\n\n第二句')
    const prose = item('assistant_text', { text: 'ordinary reply' })
    expect(presentRoomRunItems([prose])[0]).toBe(prose)
  })

  it('reduces embedded provider error payloads to their inner message', () => {
    const error = item('error', {
      kind: 'error',
      message:
        'model request failed with status 400: {"error":{"message":"The reasoning_content in the thinking mode must be passed back to the API","type":"invalid_request_error"}}'
    })
    expect(presentRoomRunItems([error])[0].message).toBe(
      'model request failed with status 400: The reasoning_content in the thinking mode must be passed back to the API'
    )
    const plain = item('error', { kind: 'error', message: 'plain failure' })
    expect(presentRoomRunItems([plain])[0]).toBe(plain)
  })

  it('parses string arguments loaded through the full-content path', () => {
    const call = item('tool_call', {
      toolName: 'send_im_message',
      callId: 'c4',
      arguments: '{"text":"完整内容","attachments":[]}' as unknown as Record<string, unknown>
    })
    const result = item('tool_result', { toolName: 'send_im_message', callId: 'c4', output: { ok: true } })
    expect(presentRoomRunItems([call, result])[0].text).toBe('完整内容')
  })
})
