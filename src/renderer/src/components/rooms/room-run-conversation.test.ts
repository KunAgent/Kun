import { describe, expect, it } from 'vitest'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { buildRoomRunConversation, buildRoomRunTranscript } from './room-run-conversation'

const item = (id: string, kind: string, fields: Record<string, unknown> = {}): CoreTurnItemJson =>
  ({ id, kind, threadId: 'thread', turnId: 'turn', role: 'assistant', status: 'completed', createdAt: `2026-09-13T10:00:${id.padStart(2, '0')}Z`, ...fields }) as CoreTurnItemJson

describe('room run conversation projection', () => {
  it('keeps one tool row for a call/result pair and classifies the trailing reply as final', () => {
    const conversation = buildRoomRunConversation([
      item('01', 'user_message', { displayText: 'follow-up' }),
      item('02', 'assistant_reasoning', { text: 'thinking about the file' }),
      item('03', 'tool_call', { callId: 'c1', toolName: 'read', arguments: { path: '/a' } }),
      item('04', 'assistant_text', { text: 'intermediate note' }),
      item('05', 'tool_result', { callId: 'c1', toolName: 'read', output: 'contents' }),
      item('06', 'assistant_text', { text: 'final answer' })
    ])

    expect(conversation.process.map((entry) => entry.kind)).toEqual(['user', 'reasoning', 'tool', 'assistant'])
    const tool = conversation.process.find((entry) => entry.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', callId: 'c1', call: { id: '03' }, result: { id: '05' } })
    expect(conversation.finalAnswer).toMatchObject({ id: '06', text: 'final answer' })
  })

  it('treats the final assistant text as the answer and keeps earlier text inside the process', () => {
    const conversation = buildRoomRunConversation([
      item('01', 'assistant_text', { text: 'part one' }),
      item('02', 'tool_call', { callId: 'c1', toolName: 'grep' }),
      item('03', 'assistant_text', { text: 'conclusion' })
    ])
    expect(conversation.process.map((entry) => entry.kind)).toEqual(['assistant', 'tool'])
    expect(conversation.finalAnswer).toMatchObject({ id: '03', text: 'conclusion' })
  })

  it('excludes hidden runtime context from both the stream and the transcript', () => {
    const conversation = buildRoomRunConversation([
      item('01', 'assistant_reasoning', { text: 'visible reasoning' }),
      item('02', 'model_context', { text: 'private context' }),
      item('03', 'assistant_text', { text: 'reply' })
    ])
    expect(conversation.process).toHaveLength(1)
    expect(conversation.process[0].kind).toBe('reasoning')
    expect(conversation.finalAnswer).toMatchObject({ id: '03' })

    const transcript = buildRoomRunTranscript(conversation, 'the request')
    expect(transcript).toContain('the request')
    expect(transcript).toContain('visible reasoning')
    expect(transcript).toContain('reply')
    expect(transcript).not.toContain('private context')
  })

  it('builds a copyable transcript from the request, tools, reasoning and reply only', () => {
    const conversation = buildRoomRunConversation([
      item('01', 'assistant_reasoning', { text: 'reasoning' }),
      item('02', 'tool_call', { callId: 'c1', toolName: 'edit', summary: 'Edit src/a.ts' }),
      item('03', 'tool_result', { callId: 'c1', toolName: 'edit' }),
      item('04', 'assistant_text', { text: 'done' })
    ])
    const transcript = buildRoomRunTranscript(conversation, 'please fix')
    expect(transcript).toBe('please fix\n\nreasoning\n\nedit Edit src/a.ts\n\ndone')
  })
})
