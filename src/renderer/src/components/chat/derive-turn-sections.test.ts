import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import { deriveTurnSections } from './derive-turn-sections'
import type { Turn } from './message-timeline-turns'

function sections(blocks: ChatBlock[]) {
  return deriveTurnSections({
    turn: { blocks } satisfies Turn,
    isProcessing: false,
    liveProcessText: '',
    liveContent: '',
    workspaceRoot: '/tmp'
  })
}

function processingSections(input: {
  blocks?: ChatBlock[]
  liveProcessText?: string
  liveContent?: string
}) {
  return deriveTurnSections({
    turn: { blocks: input.blocks ?? [] } satisfies Turn,
    isProcessing: true,
    liveProcessText: input.liveProcessText ?? '',
    liveContent: input.liveContent ?? '',
    workspaceRoot: '/tmp'
  })
}

describe('deriveTurnSections', () => {
  it('renders the final assistant answer as content even when reasoning was persisted after it', () => {
    const result = sections([
      { kind: 'assistant', id: 'answer', text: '你好！' },
      { kind: 'reasoning', id: 'reasoning', text: 'The user greeted me.' }
    ])

    expect(result.assistantContentBlocks).toEqual([
      { kind: 'assistant', id: 'answer', text: '你好！' }
    ])
    expect(result.processBlocks.map((block) => block.kind)).toEqual(['reasoning'])
  })

  it('uses the last assistant text as final content without duplicating it in process work', () => {
    const result = sections([
      { kind: 'assistant', id: 'preface', text: '我先检查一下。' },
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call'
      }
    ])

    expect(result.assistantContentBlocks).toEqual([
      { kind: 'assistant', id: 'preface', text: '我先检查一下。' }
    ])
    expect(result.processBlocks.map((block) => block.kind)).toEqual(['tool'])
  })

  it('keeps intermediate assistant text inside the process timeline and surfaces only the final answer', () => {
    const result = sections([
      { kind: 'assistant', id: 'intro', text: 'I found the likely cause.' },
      {
        kind: 'tool',
        id: 'tool_read',
        summary: 'read: source',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'read output'
      },
      {
        kind: 'assistant',
        id: 'analysis',
        text: [
          'Here is the detailed analysis:',
          '',
          '```txt',
          'command output line 1',
          'command output line 2',
          '```'
        ].join('\n')
      },
      {
        kind: 'tool',
        id: 'tool_issue',
        summary: 'web_fetch: issue',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'https://github.com/XingYu-Zhong/DeepSeek-GUI/issues/96'
      },
      { kind: 'assistant', id: 'next', text: 'The issue link above should still be visible.' }
    ])

    // Only the trailing answer renders as the visible message body; the earlier
    // "我先看看…"-style narration belongs inside the collapsed work timeline,
    // not spilled out as standalone bubbles (regression from b9d4efb0a).
    expect(result.assistantContentBlocks.map((block) => block.id)).toEqual(['next'])
    // The intermediate segments are preserved (not dropped) — just kept in the
    // process trace, in chronological order with the tool calls.
    expect(result.processBlocks.map((block) => block.id)).toEqual([
      'intro',
      'tool_read',
      'analysis',
      'tool_issue'
    ])
    expect(
      result.processBlocks
        .filter((block) => block.kind === 'assistant')
        .map((block) => block.text)
        .join('\n\n')
    ).toContain('command output line 2')
  })

  it('keeps every consecutive trailing segment but the last inside the timeline', () => {
    // Reproduces the reported case: a single command followed by several
    // consecutive assistant segments. Only the final segment is the visible
    // answer; the preface + intermediate analysis stay inside 已处理 even
    // though no tool separates them.
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_ls',
        summary: 'pwd && ls -la',
        status: 'success',
        toolKind: 'tool_call',
        detail: 'workspace listing'
      },
      { kind: 'assistant', id: 'preface', text: '我先看看当前工作目录和项目结构。' },
      { kind: 'assistant', id: 'analysis', text: '当前工作目录是 default_workspace，没有实际项目代码。' },
      { kind: 'assistant', id: 'question', text: '请问你想看哪个项目？' }
    ])

    expect(result.assistantContentBlocks.map((block) => block.id)).toEqual(['question'])
    expect(result.processBlocks.map((block) => block.id)).toEqual(['tool_ls', 'preface', 'analysis'])
  })

  it('does not create assistant content from tool-only process work', () => {
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call'
      }
    ])

    expect(result.assistantContentBlocks).toEqual([])
    expect(result.processBlocks.map((block) => block.kind)).toEqual(['tool'])
  })

  it('surfaces generated media blocks outside the collapsed process work', () => {
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_img',
        summary: 'generate_image',
        status: 'success',
        toolKind: 'tool_call',
        meta: {
          attachments: [{ id: 'att_img', name: 'img.png', mimeType: 'image/png' }],
          generatedFiles: [{ relativePath: '.deepseekgui-images/img.png', mimeType: 'image/png' }]
        }
      },
      {
        kind: 'tool',
        id: 'tool_read',
        summary: 'read',
        status: 'success',
        toolKind: 'tool_call'
      }
    ])

    expect(result.generatedFileBlocks.map((block) => block.id)).toEqual(['tool_img'])
    expect(result.processBlocks.map((block) => block.id)).toEqual(['tool_img', 'tool_read'])
  })

  it('keeps generated media visible while the turn is still processing', () => {
    const result = processingSections({
      blocks: [
        {
          kind: 'tool',
          id: 'tool_img',
          summary: 'generate_image',
          status: 'success',
          toolKind: 'tool_call',
          meta: {
            generatedFiles: [
              {
                relativePath: '.deepseekgui-images/img.png',
                mimeType: 'image/png'
              }
            ]
          }
        },
        {
          kind: 'tool',
          id: 'tool_next',
          summary: 'read',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(result.generatedFileBlocks.map((block) => block.id)).toEqual(['tool_img'])
    expect(result.processBlocks.map((block) => block.id)).toEqual(['tool_img', 'tool_next'])
  })

  it('surfaces component prototypes outside work while retaining the tool in process history', () => {
    const block: ChatBlock = {
      kind: 'tool',
      id: 'tool_component',
      summary: 'design_component',
      status: 'success',
      toolKind: 'file_change',
      meta: {
        toolName: 'design_component',
        componentPrototype: {
          version: 1,
          status: 'completed',
          artifactId: 'component_abc',
          title: 'Date range picker',
          relativePath: '.kun-design/component-prototypes/date-picker/prototype.html',
          viewport: { width: 720, height: 460 },
          profile: 'component-designer'
        }
      }
    }
    const result = sections([block])
    expect(result.componentPrototypeBlocks).toEqual([block])
    expect(result.processBlocks).toEqual([block])
  })

  it('extracts file changes from JSON-wrapped tool output diffs', () => {
    const patch = [
      'diff --git a/demo.ts b/demo.ts',
      '--- a/demo.ts',
      '+++ b/demo.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new'
    ].join('\n')
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'Edit',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/demo.ts',
        detail: JSON.stringify({ path: '/tmp/demo.ts', diff: patch }, null, 2)
      }
    ])

    expect(result.turnFileChanges).toMatchObject([
      {
        id: 'tool_1',
        detail: patch,
        filePath: 'demo.ts'
      }
    ])
  })

  it('merges repeated file changes for the same displayed path', () => {
    const firstPatch = [
      'diff --git a/.kunsdd/draft/plan/requirement.md b/.kunsdd/draft/plan/requirement.md',
      '--- a/.kunsdd/draft/plan/requirement.md',
      '+++ b/.kunsdd/draft/plan/requirement.md',
      '@@ -1,1 +1,1 @@',
      '-old title',
      '+new title'
    ].join('\n')
    const secondPatch = [
      'diff --git a/.kunsdd/draft/plan/requirement.md b/.kunsdd/draft/plan/requirement.md',
      '--- a/.kunsdd/draft/plan/requirement.md',
      '+++ b/.kunsdd/draft/plan/requirement.md',
      '@@ -4,1 +4,2 @@',
      ' context',
      '+new detail'
    ].join('\n')
    const result = sections([
      {
        kind: 'tool',
        id: 'tool_first_edit',
        summary: 'Edit requirement',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/.kunsdd/draft/plan/requirement.md',
        detail: firstPatch
      },
      {
        kind: 'tool',
        id: 'tool_second_edit',
        summary: 'Edit requirement again',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/.kunsdd/draft/plan/requirement.md',
        detail: secondPatch
      }
    ])

    expect(result.turnFileChanges).toHaveLength(1)
    expect(result.turnFileChanges[0]).toMatchObject({
      id: 'tool_first_edit',
      filePath: '.kunsdd/draft/plan/requirement.md'
    })
    expect(result.turnFileChanges[0]?.detail).toContain('+new title')
    expect(result.turnFileChanges[0]?.detail).toContain('+new detail')
  })

  it('keeps live reasoning in the process timeline; live assistant is rendered separately by MessageTimeline', () => {
    // The streaming assistant text is rendered as a dedicated MessageBubble
    // by MessageTimeline (`<MessageBubble block={{ kind: 'assistant',
    // id: 'live-assistant', text: liveContent }} />`). It must NOT also
    // appear in processBlocks, otherwise the user sees the same text twice
    // during streaming (once in the WorkMetaRow process area, once in
    // the regular message flow).
    const result = processingSections({
      liveProcessText: 'private reasoning',
      liveContent: '这里是正在生成的回答。'
    })

    expect(result.assistantContentBlocks).toEqual([])
    expect(result.processBlocks).toEqual([
      { kind: 'reasoning', id: 'live-reasoning', text: 'private reasoning' }
    ])
  })

  it('keeps assistant content in chronological process order while a later tool is still running', () => {
    const result = processingSections({
      blocks: [
        { kind: 'assistant', id: 'answer', text: '先给你一部分结果。' },
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'read',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(result.assistantContentBlocks).toEqual([])
    expect(result.processBlocks).toEqual([
      { kind: 'assistant', id: 'answer', text: '先给你一部分结果。' },
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'read',
        status: 'running',
        toolKind: 'tool_call'
      }
    ])
  })

  it('places assistant output between process steps while processing', () => {
    const result = processingSections({
      blocks: [
        {
          kind: 'tool',
          id: 'tool_1',
          summary: 'read',
          status: 'success',
          toolKind: 'tool_call'
        },
        { kind: 'assistant', id: 'answer', text: '读完了，下一步继续查。' },
        {
          kind: 'tool',
          id: 'tool_2',
          summary: 'grep',
          status: 'running',
          toolKind: 'tool_call'
        }
      ]
    })

    expect(result.assistantContentBlocks).toEqual([])
    expect(result.processBlocks.map((block) => block.id)).toEqual(['tool_1', 'answer', 'tool_2'])
  })
})
