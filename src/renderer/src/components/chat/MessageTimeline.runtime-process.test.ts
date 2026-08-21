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

  it('renders a pending request_user_input as a read-only record pointing to the composer', () => {
    const inputBlock: ChatBlock = {
      kind: 'user_input',
      id: 'ui_freeform',
      requestId: 'input_freeform',
      status: 'pending',
      // The live runtime is actively awaiting this request.
      live: true,
      questions: [
        {
          header: 'Input',
          id: 'direction',
          question: '你更想去南方还是北方？',
          options: []
        }
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-input', kind: 'execution', blocks: [inputBlock] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('你更想去南方还是北方？')
    // Answering and cancelling moved to the composer-docked panel; the bubble
    // is now only a compact record pointing to that actionable surface.
    expect(html).not.toContain('<textarea')
    expect(html).toContain('Complete this above the input box')
    expect(html).not.toContain('Cancel')
  })

  it('renders a stale pending request_user_input from history as a non-actionable record (issue #606)', () => {
    // A request rehydrated from a finished thread keeps `status: 'pending'` but
    // is not `live`, so it must not offer Cancel (which would hit a dead gate).
    const inputBlock: ChatBlock = {
      kind: 'user_input',
      id: 'ui_stale',
      requestId: 'input_stale',
      status: 'pending',
      questions: [
        {
          header: 'Input',
          id: 'direction',
          question: '你更想去南方还是北方？',
          options: []
        }
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-input', kind: 'execution', blocks: [inputBlock] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    // The record still shows what was asked…
    expect(html).toContain('你更想去南方还是北方？')
    // …but offers no live affordances, so it cannot fire a dead resolve.
    expect(html).not.toContain('Complete this above the input box')
    // It reads as an ended record rather than an active prompt.
    expect(html).toContain('Cancelled')
  })

  it('shows the current tool collapsed while the bottom running row stays active', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'inspect this file'
      },
      toolBlock({
        summary: 'read: file',
        status: 'running',
        detail: 'running timeline detail should stay collapsed',
        meta: { toolName: 'read' },
        filePath: '/tmp/project/src/app.ts'
      })
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
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Read')
    expect(html).toContain('/tmp/project/src/app.ts')
    expect(html).toContain('is-active')
    expect(html).toContain('ds-work-logo-phase-trail')
    expect(html).not.toContain('running timeline detail should stay collapsed')
  })

  it('stops a Graph planning turn when its draft pauses for correction', () => {
    expect(timelineTurnIsProcessing({
      busy: true,
      isLatestTurn: true,
      turnPending: true,
      hasLiveStream: true,
      turnId: 'turn_1',
      graphPlanningCorrectionTurnId: 'turn_1'
    })).toBe(false)
    expect(timelineTurnIsProcessing({
      busy: true,
      isLatestTurn: true,
      turnPending: false,
      hasLiveStream: false,
      turnId: 'turn_2',
      graphPlanningCorrectionTurnId: 'turn_1'
    })).toBe(true)
  })

  it('does not attach busy state to a trailing orphan when the active turn is known', () => {
    expect(timelineTurnIsProcessing({
      busy: true,
      isLatestTurn: true,
      isActiveTurn: false,
      turnPending: false,
      hasLiveStream: false
    })).toBe(false)
    expect(timelineTurnIsProcessing({
      busy: true,
      isLatestTurn: false,
      isActiveTurn: true,
      turnPending: false,
      hasLiveStream: false
    })).toBe(true)
  })

  it('keeps the fallback running animation visible between process events', () => {
    const turn = {
      user: {
        kind: 'user',
        id: 'user_1',
        text: 'keep working'
      } as const,
      blocks: [toolBlock({
        id: 'tool_read',
        summary: 'read: file',
        status: 'success',
        meta: { toolName: 'read' },
        filePath: '/tmp/project/src/app.ts'
      })]
    }

    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn,
        isProcessing: true,
        liveReasoning: '',
        live: '',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Read')
    expect(html).toContain('ds-work-logo-phase-trail')
    expect(html).toContain('is-active')
  })

  it('leaves a live runtime warning before process work that happened later', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn: {
          user: {
            kind: 'user',
            id: 'user_runtime_timeline',
            text: 'keep working'
          },
          blocks: [
            {
              kind: 'reasoning',
              id: 'reasoning_before_warning',
              text: 'Checking current memory use.'
            },
            {
              kind: 'system',
              id: 'memory_warning',
              text: 'Memory use is high.',
              code: 'memory_pressure_warning',
              severity: 'warning',
              runtimeError: true
            },
            toolBlock({
              id: 'tool_after_warning',
              summary: 'AFTER_WARNING_PROCESS_STEP',
              status: 'running',
              meta: { toolName: 'custom_tool' }
            })
          ]
        },
        isProcessing: true,
        liveReasoning: '',
        live: '',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    const warningIndex = html.indexOf('data-testid="timeline-runtime-error"')
    const laterProcessIndex = html.indexOf('AFTER_WARNING_PROCESS_STEP')
    expect(warningIndex).toBeGreaterThanOrEqual(0)
    expect(laterProcessIndex).toBeGreaterThan(warningIndex)
  })

  it('keeps intermediate text visible while compact activity details remain collapsed', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'inspect this flow'
      },
      {
        kind: 'reasoning',
        id: 'reasoning_1',
        text: 'internal reasoning should stay collapsed'
      },
      toolBlock({
        id: 'tool_read',
        summary: 'read: file',
        detail: 'completed read detail should stay collapsed',
        meta: { toolName: 'read' },
        filePath: '/tmp/project/src/flow.ts'
      }),
      {
        kind: 'assistant',
        id: 'assistant_progress',
        text: 'I found the rendering path and am checking the active state.'
      },
      toolBlock({
        id: 'tool_search',
        summary: 'grep: search',
        status: 'running',
        detail: 'running search detail should stay collapsed',
        meta: { toolName: 'grep', pattern: 'workExpanded' },
        filePath: '/tmp/project/src'
      })
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
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('I found the rendering path and am checking the active state.')
    expect(html).toContain('Read 1 file')
    expect(html).toContain('Search')
    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('Read 1 file')).toBeLessThan(
      html.indexOf('I found the rendering path and am checking the active state.')
    )
    expect(html.indexOf('I found the rendering path and am checking the active state.')).toBeLessThan(
      html.indexOf('workExpanded')
    )
    expect(html).not.toContain('internal reasoning should stay collapsed')
    expect(html).not.toContain('completed read detail should stay collapsed')
    expect(html).not.toContain('running search detail should stay collapsed')
  })

  it('auto-folds completed work and leaves only the final assistant text visible', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn: {
          user: {
            kind: 'user',
            id: 'user_completed_chain',
            text: 'finish the investigation'
          },
          blocks: [
            {
              kind: 'reasoning',
              id: 'reasoning_completed_chain',
              text: 'intermediate reasoning'
            },
            {
              kind: 'assistant',
              id: 'assistant_progress_chain',
              text: 'I am checking the relevant path.'
            },
            toolBlock({
              id: 'tool_completed_chain',
              summary: 'read: relevant path',
              meta: { toolName: 'read' },
              filePath: '/tmp/project/src/path.ts'
            }),
            {
              kind: 'assistant',
              id: 'assistant_final_chain',
              text: 'The final answer is ready.'
            }
          ]
        },
        isProcessing: false,
        liveReasoning: '',
        live: '',
        durationMs: 87_000,
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('1m 27s')
    expect(html).toContain('The final answer is ready.')
    expect(html).toContain('ds-chat-answer')
    expect(html).toMatch(/Processed 1m 27s|已处理 1m 27s/)
    expect(html).not.toContain('Read 1 file')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('I am checking the relevant path.')
    expect(html).not.toContain('intermediate reasoning')
    expect(html).not.toContain('/tmp/project/src/path.ts')
  })

  it('still expands live work automatically when an approval needs attention', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'edit this file'
      },
      {
        kind: 'approval',
        id: 'approval_1',
        approvalId: 'approval_1',
        status: 'pending',
        toolName: 'edit',
        summary: 'Run edit(path="/tmp/project/src/app.ts")'
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
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    expect(html).toContain('Run edit(path=&quot;/tmp/project/src/app.ts&quot;)')
    expect(html).toMatch(/Approval required|需要审批|approvalTitle/)
  })

  it('renders running compaction as a lightweight process status entry', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'compaction',
        id: 'compact_1',
        summary: 'Context compacted',
        status: 'running',
        auto: false
      }
    ]
    useChatStore.setState({
      busy: true,
      currentTurnUserId: null,
      turnStartedAtByUserId: {}
    })

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

    expect(html).toContain('role="status"')
    expect(html).toMatch(/Compacting|compactionRunning|正在压缩上下文/)
    expect(html).toMatch(/context|上下文/)
    expect(html).toContain('ds-work-logo-phase-trail')
    expect(html.indexOf('ds-work-logo-phase-trail')).toBeGreaterThan(
      html.indexOf('role="status"')
    )
    expect(html).not.toContain('aria-expanded=')
  })

  it('renders later live work below the compaction marker', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        turnId: 'turn_1',
        text: 'continue the task'
      },
      {
        kind: 'tool',
        id: 'before_compaction',
        turnId: 'turn_1',
        summary: 'read: before compaction',
        status: 'success',
        toolKind: 'tool_call',
        filePath: '/tmp/TIMELINE_BEFORE_COMPACTION.ts',
        meta: { toolName: 'read' }
      },
      {
        kind: 'compaction',
        id: 'compact_1',
        turnId: 'turn_1',
        summary: 'Context compacted',
        status: 'success',
        auto: true
      },
      {
        kind: 'tool',
        id: 'after_compaction',
        turnId: 'turn_1',
        summary: 'read: after compaction',
        status: 'running',
        toolKind: 'tool_call',
        filePath: '/tmp/TIMELINE_AFTER_COMPACTION.ts',
        meta: { toolName: 'read' }
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
        live: '',
        activeThreadId: 'thr_1',
        runtimeConnection: 'ready',
        onRetryConnection: () => undefined,
        onOpenSettings: () => undefined
      })
    )

    const beforeIndex = html.indexOf('TIMELINE_BEFORE_COMPACTION.ts')
    const compactionIndex = html.indexOf('data-compaction-timeline-entry="true"')
    const afterIndex = html.indexOf('TIMELINE_AFTER_COMPACTION.ts')
    expect(beforeIndex).toBeGreaterThanOrEqual(0)
    expect(compactionIndex).toBeGreaterThan(beforeIndex)
    expect(afterIndex).toBeGreaterThan(compactionIndex)
  })

  it('folds a completed runtime error behind the processed disclosure', () => {
    const blocks: ChatBlock[] = [
      {
        kind: 'user',
        id: 'user_1',
        text: 'draw this'
      },
      {
        kind: 'system',
        id: 'error_1',
        text: 'model request failed with status 400',
        detail: [
          'Code: http_400',
          '',
          'Severity: error',
          '',
          'Message:',
          'full provider body only visible in the expanded error detail'
        ].join('\n'),
        code: 'http_400',
        severity: 'error'
      }
    ]
    useChatStore.setState({
      busy: false,
      currentTurnUserId: null,
      turnStartedAtByUserId: {}
    })

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

    // Completed turns auto-collapse behind the processed disclosure, so the
    // error text and detail stay hidden until the user expands the panel.
    expect(html).toMatch(/Processed|已处理/)
    expect(html).not.toMatch(/Work process|工作过程/)
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('request failed with status 400')
    expect(html).not.toContain('Code: http_400')
    expect(html).not.toContain('full provider body only visible in the expanded error detail')
  })

  it('keeps a retry concise while exposing its provider failure through the status expander', () => {
    const retry: ChatBlock = {
      kind: 'system',
      id: 'retry_1',
      text: 'Model provider connection failed; retrying 2/5.',
      detail: 'TLS handshake failed: certificate verify failed'
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-retry', kind: 'execution', blocks: [retry] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('provider connection failed; retrying 2/5.')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('role="button"')
    expect(html).not.toContain('TLS handshake failed: certificate verify failed')
  })

  it('renders a durable runtime failure inline with expandable technical detail', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRuntimeError, {
        block: {
          kind: 'system',
          id: 'error_1',
          turnId: 'turn_1',
          text: 'Cursor SDK authentication failed',
          detail: 'Code: cursor_sdk_authentication_failed\n\nMessage:\nInvalid API key',
          code: 'cursor_sdk_authentication_failed',
          severity: 'error',
          runtimeError: true
        }
      })
    )

    expect(html).toContain('role="alert"')
    expect(html).toContain('Cursor SDK authentication failed')
    expect(html).toContain('cursor_sdk_authentication_failed')
    expect(html).toContain('<details')
    expect(html).toContain('Invalid API key')
  })

})
