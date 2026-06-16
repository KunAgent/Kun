import { describe, expect, it } from 'vitest'
import {
  feishuSenderLabel,
  finalAssistantReplyText,
  imCompletionReplyForPush,
  IM_COMPLETED_NO_TEXT_REPLY,
  type ThreadDetailJson,
  type TurnItemJson
} from './claw-runtime-helpers'

function singleTurnDetail(items: TurnItemJson[]): ThreadDetailJson {
  return { turns: [{ id: 'turn_1', status: 'completed', items }] }
}

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
