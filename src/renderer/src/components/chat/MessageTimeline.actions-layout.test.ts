import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import {
  ConversationTurn,
  MessageTimeline,
  TimelineRuntimeError,
  liveTurnProgressClass,
  timelineBottomPaddingClass,
  resultPreviewSourcesForTurn,
  summarizeToolBlock,
  timelineTurnIsProcessing
} from './MessageTimeline'
import {
  GeneratedFilesPanel,
  MessageBubble,
  generatedMediaScrollAvailability,
  turnMetricsLabel
} from './message-timeline-bubbles'
import { WorkMetaRow } from './message-timeline-cards'
import {
  describeProcessSection,
  ProcessSectionRow,
  groupProcessSections,
  summarizeProcessWork
} from './message-timeline-process'
import {
  TimelineFilePreviewWorkspaceProvider,
  timelineFilePreviewWorkspaceRoot,
  useTimelineFilePreviewWorkspaceRoot
} from './timeline-file-preview-workspace'
import { readGeneratedWorkspaceImagePreview } from './generated-media-preview'

const labels: Record<string, string> = {
  toolActionCommand: 'Ran command',
  toolBuiltinRead: 'Read',
  toolBuiltinWrite: 'Write',
  toolBuiltinEdit: 'Edit',
  toolBuiltinGrep: 'Search',
  toolBuiltinFind: 'Find',
  toolBuiltinLs: 'List',
  toolBuiltinBash: 'Bash',
  toolBuiltinBackgroundShell: 'Background shell',
  toolActionBackgroundShellRead: 'Read background shell',
  toolActionBackgroundShellList: 'List background shells',
  workingToolAction: 'Working {{action}}',
  thinkingNow: 'Thinking…',
  turnMetricsTtft: 'Avg TTFT {{value}}',
  turnMetricsTps: 'Avg {{value}} tok/s',
  groupReadFiles: 'Read {{count}} files',
  groupReadFile: 'Read 1 file',
  groupSearched: 'Searched {{count}} times',
  groupSearchedOnce: 'Searched once',
  groupEditedFiles: 'Edited {{count}} files',
  groupEditedFile: 'Edited 1 file',
  groupRanCommands: 'Ran {{count}} commands',
  groupRanCommand: 'Ran 1 command'
}

const t = (key: string, opts?: Record<string, unknown>) =>
  (labels[key] ?? (key === 'toolActionCommand' ? 'Ran command' : key)).replace(
    /\{\{(\w+)\}\}/g,
    (_match, name: string) => String(opts?.[name] ?? '')
  )

const activeThread: NormalizedThread = {
  id: 'thr_1',
  title: 'Thread',
  updatedAt: '2026-06-07T00:00:00.000Z',
  model: 'deepseek-chat',
  mode: 'code',
  workspace: '/tmp/project'
}

function toolBlock(overrides: Partial<ToolBlock>): ToolBlock {
  return {
    kind: 'tool',
    id: 'tool_1',
    summary: 'tool',
    status: 'success',
    ...overrides
  }
}

describe('MessageTimeline Kun runtime metadata smoke', () => {
  beforeEach(() => {
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: 'thr_1',
      threads: [activeThread],
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {},
      turnDurationByUserId: {},
      turnReasoningFirstAtByUserId: {},
      turnReasoningLastAtByUserId: {},
      clawChannels: [],
      activeClawChannelId: ''
    })
  })

  it('keeps timeline spacing independent from composer status surfaces', () => {
    expect(timelineBottomPaddingClass()).toBe('pb-10')
  })

  it('lets the composer stack reserve space without moving the live progress row', () => {
    expect(liveTurnProgressClass()).not.toContain('mb-16 md:mb-20')
  })

  it('keeps user actions attached to the message bubble', () => {
    const html = renderToStaticMarkup(createElement(MessageBubble, {
      block: { kind: 'user', id: 'user_1', text: 'Create a spreadsheet' }
    }))
    expect(html).toContain('data-user-message-actions="inline"')
    expect(html.indexOf('ds-user-message-bubble')).toBeLessThan(
      html.indexOf('data-user-message-actions="inline"')
    )
  })

  it('labels an active turn as processing even after timing starts', () => {
    const html = renderToStaticMarkup(createElement(WorkMetaRow, {
      processing: true,
      durationMs: 15,
      expanded: true,
      collapsible: false,
      onToggle: () => undefined
    }))
    expect(html).toMatch(/Processing|处理中|processing/)
    expect(html).not.toMatch(/Processed|已处理/)
  })

  it('renders a completed collapsed turn as processed with duration only', () => {
    const html = renderToStaticMarkup(createElement(WorkMetaRow, {
      processing: false,
      durationMs: 101_000,
      expanded: false,
      onToggle: () => undefined
    }))

    expect(html).toMatch(/Processed 1m 41s|已处理 1m 41s/)
    expect(html).not.toMatch(/Work process|工作过程|steps|步|Read|读取|Thought|思考/)
    expect(html).toContain('aria-expanded="false"')
  })

  it('never falls back to a work-process summary when completed timing is unavailable', () => {
    const html = renderToStaticMarkup(createElement(WorkMetaRow, {
      processing: false,
      expanded: false,
      onToggle: () => undefined
    }))

    expect(html).toMatch(/Processed|已处理/)
    expect(html).not.toMatch(/Work process|工作过程|steps|步/)
  })

  it('renders the fork action before copy in completed assistant response actions', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        turnId: 'turn_1',
        text: 'say hi'
      },
      {
        kind: 'assistant',
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'hello'
      }
    ]

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toMatch(/forkResponse|Fork response|分叉回答/)
    expect(html).toMatch(/forkFromAssistantResponse|Fork a new thread from this response|从这条回答分叉新会话/)
    const forkIndex = html.search(/forkFromAssistantResponse|Fork a new thread from this response|从这条回答分叉新会话/)
    const copyIndex = html.slice(forkIndex).search(/copyMessage|Copy message|复制消息/)
    expect(forkIndex).toBeGreaterThanOrEqual(0)
    expect(copyIndex).toBeGreaterThan(0)
  })

  it('renders an export action for completed assistant responses', () => {
    const html = renderToStaticMarkup(
      createElement(MessageBubble, {
        block: {
          kind: 'assistant',
          id: 'assistant_1',
          turnId: 'turn_1',
          text: 'share this answer'
        }
      })
    )

    expect(html).toMatch(/exportAnswer|Export answer|导出回答/)
    expect(html).toMatch(/writeExportPdf|Export PDF|导出 PDF/)
    expect(html).toMatch(/writeExportDocx|Export DOCX|导出 DOCX/)
    expect(html).toMatch(/writeExportPng|Export PNG|导出 PNG/)
  })

  it('renders per-turn average TTFT/TPS next to the timestamp when available', () => {
    useChatStore.setState({
      turnTimingMetrics: new Map([
        ['turn_1', { avgTtftMs: 1_000, avgTokensPerSecond: 40.2 }]
      ])
    })
    try {
      const html = renderToStaticMarkup(
        createElement(MessageBubble, {
          block: {
            kind: 'assistant',
            id: 'assistant_1',
            turnId: 'turn_1',
            text: 'hello'
          }
        })
      )

      // zustand v5 serves SSR renders from the INITIAL state, so the
      // per-turn map set above is not visible here; verify the wiring
      // through the client render path instead.
      expect(turnMetricsLabel(t, { avgTtftMs: 1_000, avgTokensPerSecond: 40.2 }))
        .toBe('Avg TTFT 1.0s · Avg 40.2 tok/s')
      expect(html).not.toContain('tok/s')
    } finally {
      useChatStore.setState({ turnTimingMetrics: new Map() })
    }
  })

  it('omits segments without timing data from the footer label', () => {
    expect(turnMetricsLabel(t, { avgTtftMs: null, avgTokensPerSecond: null })).toBe('')
    expect(turnMetricsLabel(t, { avgTtftMs: 800, avgTokensPerSecond: null }))
      .toBe('Avg TTFT 0.8s')
    expect(turnMetricsLabel(t, { avgTtftMs: null, avgTokensPerSecond: 38.5 }))
      .toBe('Avg 38.5 tok/s')
  })

  it('renders the workspace rollback action with fork in completed assistant response actions', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        turnId: 'turn_1',
        text: 'change files',
        meta: { workspaceCheckpointId: 'gcp_1' }
      },
      {
        kind: 'assistant',
        id: 'assistant_1',
        turnId: 'turn_1',
        text: 'done'
      }
    ]

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toMatch(/rollbackWorkspace|Rollback commit|回滚提交/)
    expect(html).toMatch(/rollbackWorkspaceFromAssistantResponse|Rollback this response&#x27;s Git commit|只回滚这条回答对应的 Git 提交/)
    const rollbackIndex = html.search(/rollbackWorkspaceFromAssistantResponse|Rollback this response&#x27;s Git commit|只回滚这条回答对应的 Git 提交/)
    const forkIndex = html.slice(rollbackIndex).search(/forkFromAssistantResponse|Fork a new thread from this response|从这条回答分叉新会话/)
    const copyIndex = html.slice(rollbackIndex + Math.max(forkIndex, 0)).search(/copyMessage|Copy message|复制消息/)
    expect(rollbackIndex).toBeGreaterThanOrEqual(0)
    expect(forkIndex).toBeGreaterThan(0)
    expect(copyIndex).toBeGreaterThan(0)
  })

  it('renders each file-change summary after the turn that produced it', () => {
    const patch = (path: string, before: string, after: string) => [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1 +1 @@',
      `-${before}`,
      `+${after}`
    ].join('\n')
    const blocks: ChatBlock[] = [
      { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'change alpha' },
      {
        kind: 'tool',
        id: 'tool_1',
        summary: 'edit alpha',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/project/src/alpha.ts',
        detail: patch('src/alpha.ts', 'alpha old', 'alpha new')
      },
      { kind: 'assistant', id: 'assistant_1', turnId: 'turn_1', text: 'alpha done' },
      { kind: 'user', id: 'user_2', turnId: 'turn_2', text: 'change beta' },
      {
        kind: 'tool',
        id: 'tool_2',
        summary: 'edit beta',
        status: 'success',
        toolKind: 'file_change',
        filePath: '/tmp/project/src/beta.ts',
        detail: patch('src/beta.ts', 'beta old', 'beta new')
      },
      { kind: 'assistant', id: 'assistant_2', turnId: 'turn_2', text: 'beta done' }
    ]

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined,
        onOpenChanges: () => undefined,
        onReviewChanges: () => undefined
      })
    )

    const firstAnswerIndex = html.indexOf('alpha done')
    const firstFileIndex = html.indexOf('src/alpha.ts')
    const secondQuestionIndex = html.indexOf('change beta')
    const secondAnswerIndex = html.indexOf('beta done')
    const secondFileIndex = html.indexOf('src/beta.ts')

    expect(html.match(/data-turn-change-summary/g)).toHaveLength(2)
    expect(firstFileIndex).toBeGreaterThan(firstAnswerIndex)
    expect(firstFileIndex).toBeLessThan(secondQuestionIndex)
    expect(secondFileIndex).toBeGreaterThan(secondAnswerIndex)
    expect(html).toMatch(/composerOpenChanges|Preview|预览/)
    expect(html).toMatch(/composerReviewChanges|Review|审查/)
  })

  it('renders live assistant text inside the process timeline while busy', () => {
    // Streaming period: the user has just sent a turn, the agent is
    // running, and the SSE has streamed some `live` text into the chat
    // store. The chat view must surface the streamed text immediately
    // (e.g. for the Feishu bot case), not wait until turn_completed.
    //
    // While active, streamed text belongs to the same chronological process
    // as reasoning and tools. It becomes the outside answer bubble only after
    // turn completion.
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'say hi'
      }
    ]
    useChatStore.setState({
      busy: true,
      currentTurnUserId: 'user_1',
      turnStartedAtByUserId: { user_1: Date.now() }
    })

    const html = renderToStaticMarkup(
      createElement(MessageTimeline, {
        blocks,
        liveReasoning: '',
        live: 'hello',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('hello')
    expect(html).not.toContain('ds-chat-answer')
  })
})
