import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatBlock } from '../../agent/types'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { ConversationTurn } from './MessageTimeline'
import type { Turn } from './message-timeline-turns'

function renderTurn(turn: Turn, isProcessing: boolean): string {
  return renderToStaticMarkup(createElement(ConversationTurn, {
    turn,
    isProcessing,
    liveReasoning: '',
    live: '',
    filePreviewWorkspaceRoot: '/tmp/project',
    viewportRef: { current: null }
  }))
}

describe('ConversationTurn awaiting-input progress row', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useChatStore.setState({
      route: 'chat',
      workspaceRoot: '/tmp/project',
      activeThreadId: 'thr_1',
      threads: [{
        id: 'thr_1',
        title: 'Thread',
        updatedAt: '2026-08-21T00:00:00.000Z',
        model: 'deepseek-chat',
        mode: 'code',
        workspace: '/tmp/project'
      }],
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

  it('lets the live user-input card own status without a duplicate trailing row', () => {
    const html = renderTurn(
      {
        turnId: 'turn_1',
        user: { kind: 'user', id: 'user_1', text: 'Continue' },
        blocks: [
          {
            kind: 'user_input',
            id: 'ui_1',
            requestId: 'input_1',
            status: 'pending',
            live: true,
            questions: [
              { header: 'Input', id: 'q1', question: 'Pick one', options: [] }
            ]
          } as ChatBlock
        ]
      },
      true
    )
    expect(html).toContain('Waiting for your answer')
    expect(html).not.toContain('data-turn-live-status-owner="generic"')
    expect(html).not.toContain('data-work-meta-row="true"')
    expect(html).not.toContain('Thinking')
  })

  it('keeps the generic progress label for a stale pending request from history', () => {
    const html = renderTurn(
      {
        turnId: 'turn_2',
        user: { kind: 'user', id: 'user_2', text: 'Old thread' },
        blocks: [
          {
            kind: 'user_input',
            id: 'ui_2',
            requestId: 'input_2',
            status: 'pending',
            questions: [
              { header: 'Input', id: 'q2', question: 'Pick one', options: [] }
            ]
          } as ChatBlock
        ]
      },
      true
    )
    expect(html).toContain('data-turn-live-status-owner="generic"')
    expect(html).not.toContain('Awaiting your input')
  })

  it('lets a running child card own the live status and timer', () => {
    const html = renderTurn({
      turnId: 'turn_child',
      user: { kind: 'user', id: 'user_child', turnId: 'turn_child', text: 'Continue child' },
      blocks: [{
        kind: 'tool', id: 'tool_child', turnId: 'turn_child', summary: 'ppt_agent',
        status: 'running', detail: JSON.stringify({ childId: 'child_1', status: 'running' }),
        meta: {
          toolName: 'ppt_agent',
          child: {
            parentThreadId: 'thr_1', parentTurnId: 'turn_child', childId: 'child_1',
            childStatus: 'running', childSeq: 1
          }
        }
      }]
    }, true)

    expect(html).toContain('data-testid="subagent-call-card"')
    expect(html).not.toContain('data-turn-live-status-owner="generic"')
    expect(html).not.toContain('data-work-meta-row="true"')
  })

  it('shows completed work metadata and puts archive after the final result', () => {
    const html = renderTurn({
      turnId: 'turn_done',
      user: { kind: 'user', id: 'user_done', turnId: 'turn_done', text: 'Finish' },
      blocks: [
        { kind: 'reasoning', id: 'reasoning_done', turnId: 'turn_done', text: 'Worked' },
        { kind: 'assistant', id: 'assistant_done', turnId: 'turn_done', text: 'Finished result' }
      ]
    }, false)

    expect(html).toContain('data-work-meta-row="true"')
    expect(html.indexOf('Finished result')).toBeLessThan(html.indexOf('data-archive-history-action'))
  })

  it('does not offer archive for a settled user-only turn', () => {
    const html = renderTurn({
      turnId: 'turn_empty',
      user: { kind: 'user', id: 'user_empty', turnId: 'turn_empty', text: 'No result yet' },
      blocks: []
    }, false)

    expect(html).not.toContain('data-archive-history-action')
  })
})
