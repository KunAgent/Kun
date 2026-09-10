import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { deriveTurnSections } from './derive-turn-sections'
import type { Turn } from './message-timeline-turns'

function derive(blocks: ChatBlock[], isProcessing = false) {
  return deriveTurnSections({
    turn: { blocks } satisfies Turn,
    isProcessing,
    liveProcessText: '',
    liveContent: '',
    workspaceRoot: '/tmp'
  })
}

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    toolKind: 'tool_call',
    ...overrides
  }
}

describe('deriveTurnSections guided user timeline', () => {
  it('keeps a same-turn guided input as an ordered entry and splits process folding around it', () => {
    const result = derive([
      { kind: 'assistant', id: 'preface', text: '先检查一下。' },
      toolBlock({ id: 'tool_before_guide', summary: 'read' }),
      {
        kind: 'user',
        id: 'q-guide-1',
        turnId: 'turn_1',
        text: '改成紧凑布局',
        meta: { displayText: '改成紧凑布局' }
      },
      { kind: 'reasoning', id: 'reasoning_after_guide', text: '用户要求紧凑布局。' },
      toolBlock({ id: 'tool_after_guide', summary: 'edit' }),
      { kind: 'assistant', id: 'answer', text: '已按紧凑布局调整。' }
    ])

    expect(result.appendedUserBlocks.map((block) => block.id)).toEqual(['q-guide-1'])
    expect(result.timelineEntries.map((entry) => entry.kind)).toEqual([
      'process',
      'user',
      'process',
      'answer'
    ])

    const [firstSegment, guided, secondSegment, answer] = result.timelineEntries
    expect(firstSegment.kind === 'process' && firstSegment.segment.blocks.map((block) => block.id)).toEqual([
      'preface',
      'tool_before_guide'
    ])
    expect(guided.kind === 'user' && guided.block.id).toBe('q-guide-1')
    expect(secondSegment.kind === 'process' && secondSegment.segment.blocks.map((block) => block.id)).toEqual([
      'reasoning_after_guide',
      'tool_after_guide'
    ])
    expect(answer.kind === 'answer' && answer.block.id).toBe('answer')

    // The final answer stays in chronological position instead of being hoisted
    // above the guided input or folded into hidden process work.
    expect(result.assistantContentBlocks).toEqual([])
    expect(result.processBlocks.map((block) => block.id)).toEqual([
      'preface',
      'tool_before_guide',
      'reasoning_after_guide',
      'tool_after_guide'
    ])
  })

  it('keeps multiple guided inputs, including repeated text, as distinct entries', () => {
    const result = derive([
      { kind: 'assistant', id: 'preface', text: '开始。' },
      { kind: 'user', id: 'q-guide-1', turnId: 'turn_1', text: '继续' },
      toolBlock({ id: 'tool_1', summary: 'read' }),
      { kind: 'user', id: 'q-guide-2', turnId: 'turn_1', text: '继续' },
      { kind: 'assistant', id: 'answer', text: '完成。' }
    ])

    expect(result.appendedUserBlocks.map((block) => block.id)).toEqual([
      'q-guide-1',
      'q-guide-2'
    ])
    expect(result.timelineEntries.map((entry) => entry.kind)).toEqual([
      'process',
      'user',
      'process',
      'user',
      'answer'
    ])
  })

  it('keeps the final answer in order when a guided input arrives after it', () => {
    const result = derive([
      { kind: 'assistant', id: 'answer', text: '任务已完成。' },
      { kind: 'user', id: 'q-guide-late', turnId: 'turn_1', text: '再补一条说明。' }
    ])

    expect(result.timelineEntries.map((entry) => entry.kind)).toEqual(['answer', 'user'])
    expect(result.assistantContentBlocks).toEqual([])
  })

  it('does not promote background or internal runtime notices to user bubbles', () => {
    const result = derive([
      { kind: 'assistant', id: 'preface', text: '继续。' },
      {
        kind: 'user',
        id: 'notice_1',
        text: '<background_shell_completed><session_id>abcd1234</session_id></background_shell_completed>',
        meta: { displayText: 'Background shell abcd1234 completed', messageSource: 'background_shell' }
      },
      {
        kind: 'user',
        id: 'graph_runtime_1',
        text: 'Graph Lead supervision for durable run run_1.',
        meta: { messageSource: 'graph_runtime' }
      },
      { kind: 'assistant', id: 'answer', text: '完成。' }
    ])

    expect(result.appendedUserBlocks).toEqual([])
    expect(result.timelineEntries).toEqual([])
    expect(result.assistantContentBlocks.map((block) => block.id)).toEqual(['answer'])
  })

  it('keeps the existing settled projection for turns without guided inputs', () => {
    const result = derive([
      { kind: 'assistant', id: 'preface', text: '先检查一下。' },
      toolBlock({ id: 'tool_1', summary: 'read' }),
      { kind: 'assistant', id: 'answer', text: '完成。' }
    ])

    expect(result.appendedUserBlocks).toEqual([])
    expect(result.timelineEntries).toEqual([])
    expect(result.assistantContentBlocks.map((block) => block.id)).toEqual(['answer'])
    expect(result.processBlocks.map((block) => block.id)).toEqual(['preface', 'tool_1'])
  })

  it('appends the live tail to a trailing segment while a guided turn is running', () => {
    const result = deriveTurnSections({
      turn: {
        blocks: [
          { kind: 'assistant', id: 'preface', text: '开始。' },
          { kind: 'user', id: 'q-guide-1', turnId: 'turn_1', text: '继续' }
        ]
      } satisfies Turn,
      isProcessing: true,
      liveProcessText: '',
      liveContent: '流式回答中。',
      workspaceRoot: '/tmp'
    })

    expect(result.timelineEntries.map((entry) => entry.kind)).toEqual(['process', 'user', 'process'])
    const liveSegment = result.timelineEntries[2]
    expect(liveSegment.kind === 'process' && liveSegment.segment.blocks.map((block) => block.id)).toEqual([
      'live-assistant'
    ])
  })
})
