import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatBlock, NormalizedThread, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { ConversationTurn, MessageTimeline } from './MessageTimeline'
import { deriveTurnSections } from './derive-turn-sections'
import { OrderedTurnTimeline } from './message-timeline-ordered-timeline'
import type { Turn } from './message-timeline-turns'

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
    toolKind: 'tool_call',
    ...overrides
  }
}

function guidedTurn(): Turn {
  return {
    user: { kind: 'user', id: 'user_1', turnId: 'turn_1', text: 'FIRSTUSERTOKEN' },
    blocks: [
      { kind: 'assistant', id: 'preface', text: 'PREFACETOKEN' },
      toolBlock({
        id: 'tool_before_guide',
        summary: 'read',
        status: 'success',
        meta: { toolName: 'read' },
        detail: 'HIDDENPROCESSDETAIL'
      }),
      {
        kind: 'user',
        id: 'q-guide-1',
        turnId: 'turn_1',
        text: 'GUIDANCETOKEN',
        meta: { displayText: 'GUIDANCETOKEN' }
      },
      toolBlock({
        id: 'tool_after_guide',
        summary: 'edit',
        status: 'success',
        meta: { toolName: 'edit' }
      }),
      { kind: 'assistant', id: 'answer', turnId: 'turn_1', text: 'FINALANSWERTOKEN' }
    ]
  }
}

function renderTurn(
  turn: Turn,
  isProcessing = false,
  extra: Record<string, unknown> = {}
): string {
  return renderToStaticMarkup(
    createElement(ConversationTurn, {
      turn,
      isProcessing,
      liveReasoning: '',
      live: '',
      filePreviewWorkspaceRoot: '/tmp/project',
      viewportRef: { current: null },
      ...extra
    })
  )
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

describe('guided user bubble inside a running turn', () => {
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

  it('renders the guided input once, in chronological order, with collapsed process work hidden', () => {
    const html = renderTurn(guidedTurn())

    expect(countOf(html, 'GUIDANCETOKEN')).toBe(1)
    expect(html.indexOf('FIRSTUSERTOKEN')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('FIRSTUSERTOKEN')).toBeLessThan(html.indexOf('GUIDANCETOKEN'))
    expect(html.indexOf('GUIDANCETOKEN')).toBeLessThan(html.indexOf('FINALANSWERTOKEN'))
    // Each user-message boundary folds its own process segment.
    expect(countOf(html, 'data-work-meta-row')).toBe(2)
    expect(html).not.toContain('PREFACETOKEN')
  })

  it('keeps the guided bubble and the live process work visible while the turn runs', () => {
    const html = renderTurn(guidedTurn(), true, { live: 'LIVESTREAMTOKEN' })

    expect(countOf(html, 'GUIDANCETOKEN')).toBe(1)
    expect(html.indexOf('FIRSTUSERTOKEN')).toBeLessThan(html.indexOf('GUIDANCETOKEN'))
    expect(html.indexOf('GUIDANCETOKEN')).toBeLessThan(html.indexOf('LIVESTREAMTOKEN'))
    expect(html).toContain('PREFACETOKEN')
    expect(html).toContain('data-turn-live-status-owner="generic"')
    expect(countOf(html, 'data-work-meta-row')).toBe(0)
  })

  it('renders image attachments on the guided bubble', () => {
    const turn = guidedTurn()
    turn.blocks[2] = {
      kind: 'user',
      id: 'q-guide-image',
      turnId: 'turn_1',
      text: 'IMAGEGUIDANCETOKEN',
      meta: {
        displayText: 'IMAGEGUIDANCETOKEN',
        attachments: [
          { id: 'att_guide_image', kind: 'image', name: 'guided-shot.png', mimeType: 'image/png' }
        ]
      }
    }

    const html = renderTurn(turn, true)

    expect(countOf(html, 'IMAGEGUIDANCETOKEN')).toBe(1)
    expect(html).toContain('data-extension-attachment-id="att_guide_image"')
  })

  it('keeps intentionally repeated guided text as two separate bubbles', () => {
    const turn = guidedTurn()
    turn.blocks[2] = {
      kind: 'user',
      id: 'q-guide-repeat-1',
      turnId: 'turn_1',
      text: 'REPEATTOKEN'
    }
    turn.blocks.splice(4, 0, {
      kind: 'user',
      id: 'q-guide-repeat-2',
      turnId: 'turn_1',
      text: 'REPEATTOKEN'
    })

    const html = renderTurn(turn)

    expect(countOf(html, 'REPEATTOKEN')).toBe(2)
    expect(html.indexOf('REPEATTOKEN')).toBeLessThan(html.lastIndexOf('REPEATTOKEN'))
    expect(html.indexOf('REPEATTOKEN')).toBeLessThan(html.indexOf('FINALANSWERTOKEN'))
  })

  it('keeps the guided bubble after a settled re-render of the same turn', () => {
    const first = renderTurn(guidedTurn())
    const second = renderTurn(guidedTurn())

    expect(countOf(first, 'GUIDANCETOKEN')).toBe(1)
    expect(countOf(second, 'GUIDANCETOKEN')).toBe(1)
  })

  it('renders the guided bubble through the full groupTurns -> MessageTimeline path', () => {
    const turn = guidedTurn()
    const blocks: ChatBlock[] = [turn.user!, ...turn.blocks]
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

    expect(countOf(html, 'GUIDANCETOKEN')).toBe(1)
    expect(html.indexOf('FIRSTUSERTOKEN')).toBeLessThan(html.indexOf('GUIDANCETOKEN'))
    expect(html.indexOf('GUIDANCETOKEN')).toBeLessThan(html.indexOf('FINALANSWERTOKEN'))
    expect(countOf(html, 'data-work-meta-row')).toBe(2)
  })

  it('reveals folded process segments when the turn work is expanded', () => {
    const turn = guidedTurn()
    const { timelineEntries } = deriveTurnSections({
      turn,
      isProcessing: false,
      liveProcessText: '',
      liveContent: '',
      workspaceRoot: '/tmp/project'
    })
    const html = renderToStaticMarkup(
      createElement(OrderedTurnTimeline, {
        entries: timelineEntries,
        isProcessing: false,
        expanded: true,
        onToggle: () => undefined,
        workspaceRoot: '/tmp/project',
        viewportRef: { current: null },
        allowThreadActions: true,
        allowRecoveryContinue: true,
        onContinueInterrupted: () => undefined
      })
    )

    expect(countOf(html, 'data-work-meta-row')).toBe(2)
    expect(html).toContain('PREFACETOKEN')
    expect(countOf(html, 'GUIDANCETOKEN')).toBe(1)
  })

  it('keeps runtime errors visible outside the folded process work', () => {
    const turn = guidedTurn()
    turn.blocks.splice(3, 0, {
      kind: 'system',
      id: 'runtime_error_after_guide',
      turnId: 'turn_1',
      text: 'RUNTIMEERRORTOKEN',
      code: 'stream_error',
      runtimeError: true
    })

    const html = renderTurn(turn)

    expect(countOf(html, 'RUNTIMEERRORTOKEN')).toBe(1)
    expect(html.indexOf('GUIDANCETOKEN')).toBeLessThan(html.indexOf('RUNTIMEERRORTOKEN'))
    expect(html.indexOf('RUNTIMEERRORTOKEN')).toBeLessThan(html.indexOf('FINALANSWERTOKEN'))
    expect(html).not.toContain('PREFACETOKEN')
  })
})
