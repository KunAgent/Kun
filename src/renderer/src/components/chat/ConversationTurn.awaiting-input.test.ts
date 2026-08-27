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

  it('shows the awaiting label instead of thinking while a live user_input is pending', () => {
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
    expect(html).toContain('Awaiting your input')
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
    expect(html).not.toContain('Awaiting your input')
  })
})
