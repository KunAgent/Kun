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

  it('renders managed Claw prompts as the user-visible message', () => {
    const block: ChatBlock = {
      kind: 'user',
      id: 'user_claw',
      text: [
        '[Claw managed instructions]',
        '',
        '[Claw IM agent instructions]',
        '',
        '[Agent name]',
        'kun',
        '',
        '---',
        '[Current user request]',
        '[Feishu / Lark inbound message]',
        'Chat type: p2p',
        'Sender: user-1',
        '',
        'hi'
      ].join('\n')
    }

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('hi')
    expect(html).not.toContain('Claw managed instructions')
    expect(html).not.toContain('Agent name')
    expect(html).not.toContain('Feishu / Lark inbound message')
  })

  it('renders tool-specific metadata chips in tool bubbles', () => {
    const block: ToolBlock = toolBlock({
      summary: 'web_search: docs',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'Kun docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).not.toContain('Attachments 1')
    expect(html).not.toContain('Skills 1')
    expect(html).not.toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
    expect(html).toContain('https://example.com/kun')
  })

  it('renders failed tool bubbles with the orange warning tone', () => {
    const block: ToolBlock = toolBlock({
      summary: 'recognize_image failed',
      status: 'error',
      detail: 'model request failed with status 401',
      meta: { toolName: 'recognize_image', exit_code: 1 }
    })

    const html = renderToStaticMarkup(createElement(MessageBubble, { block }))

    expect(html).toContain('border-orange-300/80')
    expect(html).toContain('bg-orange-500/10')
    expect(html).toContain('text-orange-800')
    expect(html).not.toContain('border-red-300/80')
    expect(html).not.toContain('bg-red-500/10')
  })

  it('renders tool-specific runtime metadata on process timeline rows', () => {
    const block: ChatBlock = toolBlock({
      summary: 'delegate: research',
      meta: {
        attachmentIds: ['att_1'],
        activeSkillIds: ['skill_docs'],
        injectedMemoryIds: ['mem_1'],
        child: {
          childId: 'child_research',
          childLabel: 'research'
        },
        sources: [
          {
            title: 'Kun docs',
            url: 'https://example.com/kun'
          }
        ]
      }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).not.toContain('Attachments 1')
    expect(html).not.toContain('Skills 1')
    expect(html).not.toContain('Memories 1')
    expect(html).toContain('Child agent')
    expect(html).toContain('research')
    expect(html).toContain('Sources 1')
  })

  it('keeps running tool calls collapsed by default without in-row loading chrome', () => {
    const block: ChatBlock = toolBlock({
      summary: 'read: file',
      status: 'running',
      detail: 'partial tool output while running',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_1', kind: 'execution', blocks: [block] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Read')
    expect(html).toContain('/tmp/readme.md')
    expect(html).not.toContain('is-active')
    expect(html).not.toContain('ds-shiny-text')
    expect(html).not.toContain('partial tool output while running')
    expect(html).toContain('ds-process-file-reference')
  })

  it('keeps a completed failed-tool detail collapsed by default while staying expandable', () => {
    const block: ChatBlock = toolBlock({
      summary: 'Recognize image recognize_image',
      status: 'error',
      detail: 'model request failed with status 401',
      meta: { toolName: 'recognize_image' }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_error', kind: 'execution', blocks: [block] },
        processing: false,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    // The header (summary + warning tone) renders, but once the turn has
    // completed a failed tool call stays collapsed by default — the error
    // detail is revealed only after the user expands the row.
    expect(html).toContain('Recognize image recognize_image')
    expect(html).toContain('text-orange-700')
    expect(html).not.toContain('text-red-600')
    expect(html).not.toContain('model request failed with status 401')
    expect(html).toContain('role="button"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps an active failed-tool detail collapsed while the turn is running', () => {
    const block: ChatBlock = toolBlock({
      summary: 'Recognize image recognize_image',
      status: 'error',
      detail: 'model request failed with status 401',
      meta: { toolName: 'recognize_image' }
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-tool_error', kind: 'execution', blocks: [block] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Recognize image recognize_image')
    expect(html).toContain('text-orange-700')
    expect(html).not.toContain('model request failed with status 401')
    expect(html).toContain('aria-expanded="false"')
  })

  it('keeps failed-tool details collapsed inside an active tool batch', () => {
    const failedBlock: ChatBlock = toolBlock({
      id: 'tool_failed',
      summary: 'Search src',
      status: 'error',
      detail: 'search error detail should stay tucked away',
      meta: { toolName: 'grep', pattern: 'needle' },
      filePath: '/tmp/src'
    })
    const successfulBlock: ChatBlock = toolBlock({
      id: 'tool_success',
      summary: 'Read file',
      status: 'success',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: {
          id: 'execution-active-batch',
          kind: 'execution',
          blocks: [failedBlock, successfulBlock]
        },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    // Tool failures must not open the batch or tint the folded header; the
    // warning-toned inner rows only appear after the user expands.
    expect(html).toContain('Read 1 file · Searched once')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Search needle')
    expect(html).not.toContain('text-orange-700')
    expect(html).not.toContain('search error detail should stay tucked away')
    expect(html).not.toContain('read detail should stay tucked away')
  })

  it('folds live thinking into the preceding non-text process batch', () => {
    const turn = {
      user: {
        kind: 'user' as const,
        id: 'user_1',
        text: 'keep reviewing'
      },
      blocks: [
        toolBlock({
          id: 'tool_read',
          summary: 'read: file',
          status: 'success',
          meta: { toolName: 'read' },
          filePath: '/tmp/project/src/app.ts'
        })
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn,
        isProcessing: true,
        liveReasoning: '**current reasoning summary**\n\n<!-- -->',
        live: '',
        durationMs: 74_000,
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('1m 14s')
    expect(html).toContain('Thinking… · Read 1 file')
    expect(html).not.toContain('data-work-meta-row="true"')
    expect(html).toContain('data-turn-live-status-owner="generic"')
    expect(html).toContain('ds-shiny-text')
    expect(html).toContain('aria-expanded="false"')
    expect(html.match(/ds-work-logo-phase-trail/g) ?? []).toHaveLength(1)
    expect(html.indexOf('ds-work-logo-phase-trail')).toBeGreaterThan(
      html.indexOf('Thinking… · Read 1 file')
    )
    expect(html).not.toContain('current reasoning summary')
    expect(html).not.toContain('&lt;!-- --&gt;')
  })

  it('uses the latest completed tool as the live fallback action', () => {
    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn: {
          user: {
            kind: 'user',
            id: 'user_latest_tool',
            text: 'inspect the current file'
          },
          blocks: [
            toolBlock({
              id: 'tool_latest_read',
              summary: 'read: current file',
              status: 'success',
              meta: { toolName: 'read' },
              filePath: '/tmp/project/src/current.ts'
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

    expect((html.match(/\/tmp\/project\/src\/current\.ts/g) ?? [])).toHaveLength(2)
  })

  it('keeps same-batch tool calls collapsed by default', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const grepBlock: ChatBlock = toolBlock({
      id: 'tool_grep',
      summary: 'grep: search',
      detail: 'grep detail should stay tucked away',
      meta: { toolName: 'grep', pattern: 'needle' },
      filePath: '/tmp/src'
    })

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, grepBlock] },
        processing: false,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Read 1 file · Searched once')
    expect(html).not.toContain('ds-work-stack')
    expect(html).not.toContain('/tmp/readme.md')
    expect(html).not.toContain('needle')
    expect(html).not.toContain('read detail should stay tucked away')
    expect(html).not.toContain('grep detail should stay tucked away')
  })

  it('folds non-text work before the following live assistant text', () => {
    const turn = {
      user: {
        kind: 'user' as const,
        id: 'user_1',
        text: 'review the release'
      },
      blocks: [
        toolBlock({
          id: 'tool_read',
          summary: 'read: file',
          status: 'success',
          meta: { toolName: 'read' }
        }),
        toolBlock({
          id: 'tool_grep',
          summary: 'grep: search',
          status: 'success',
          meta: { toolName: 'grep', pattern: 'needle' }
        })
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ConversationTurn, {
        turn,
        isProcessing: true,
        liveReasoning: 'next plan',
        live: '发现阻塞项：继续审阅。',
        filePreviewWorkspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('Thinking… · Read 1 file · Searched once')
    expect(html).toContain('发现阻塞项：继续审阅。')
    expect(html).toContain('aria-expanded="false"')
    expect(html.indexOf('Thinking… · Read 1 file · Searched once')).toBeLessThan(
      html.indexOf('发现阻塞项：继续审阅。')
    )
    expect(html.match(/ds-work-logo-phase-trail/g) ?? []).toHaveLength(1)
    expect(html.indexOf('ds-work-logo-phase-trail')).toBeGreaterThan(
      html.indexOf('发现阻塞项：继续审阅。')
    )
  })

  it('keeps pending request_user_input compact while other tool details stay tucked away', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const inputBlock: ChatBlock = {
      kind: 'user_input',
      id: 'ui_1',
      requestId: 'input_1',
      status: 'pending',
      live: true,
      questions: [
        {
          header: 'Dinner',
          id: 'dinner',
          question: 'What should we eat tonight?',
          options: [
            {
              label: 'Noodles',
              description: 'Fast and warm'
            }
          ]
        }
      ]
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, inputBlock] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-work-stack')
    expect(html).toContain('What should we eat tonight?')
    expect(html).not.toContain('Noodles')
    expect(html).toContain('Complete this above the input box')
    expect(html).not.toContain('read detail should stay tucked away')
  })

  it('auto-expands pending approvals while keeping other tool details tucked away', () => {
    const readBlock: ChatBlock = toolBlock({
      id: 'tool_read',
      summary: 'read: file',
      detail: 'read detail should stay tucked away',
      meta: { toolName: 'read' },
      filePath: '/tmp/readme.md'
    })
    const approvalBlock: ChatBlock = {
      kind: 'approval',
      id: 'approval_appr_1',
      approvalId: 'appr_1',
      status: 'pending',
      toolName: 'edit',
      summary: 'Run edit(path="/tmp/app.ts")'
    }

    const html = renderToStaticMarkup(
      createElement(ProcessSectionRow, {
        section: { id: 'execution-batch', kind: 'execution', blocks: [readBlock, approvalBlock] },
        processing: true,
        singleReasoningSection: false,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null }
      })
    )

    expect(html).toContain('ds-work-stack')
    expect(html).toContain('Run edit(path=&quot;/tmp/app.ts&quot;)')
    expect(html).toMatch(/Approval required|需要审批|approvalTitle/)
    expect(html).toMatch(/Allow|允许|approvalAllow/)
    expect(html).not.toContain('read detail should stay tucked away')
  })

  it('renders automatic review rationale without manual Allow or Deny controls', () => {
    const reviewBlock: ChatBlock = {
      kind: 'approval_review',
      id: 'approval-review-review_1',
      reviewId: 'review_1',
      approvalId: 'approval_1',
      status: 'denied',
      toolName: 'exec_command',
      summary: 'Run a host command',
      riskLevel: 'high',
      rationale: 'The command targets a path outside the workspace.'
    }

    const html = renderToStaticMarkup(
      createElement(MessageBubble, { block: reviewBlock })
    )

    expect(html).toContain('Kun approval review')
    expect(html).toContain('Denied by Kun')
    expect(html).toContain('Risk: high')
    expect(html).toContain('The command targets a path outside the workspace.')
    expect(html).not.toContain('>Allow<')
    expect(html).not.toContain('>Deny<')
    expect(html).not.toContain('approvalAllow')
    expect(html).not.toContain('approvalDeny')
  })

})
