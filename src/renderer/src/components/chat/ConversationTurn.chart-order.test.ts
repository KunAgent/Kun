import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { ConversationTurn } from './MessageTimeline'
import type { Turn } from './message-timeline-turns'

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>()
  return {
    ...actual,
    Download: () => null,
    Expand: () => null,
    Table2: () => null,
    X: () => null
  }
})

const chartSpec = {
  version: 1 as const,
  type: 'line' as const,
  title: 'Latency trend',
  data: [{ day: 'Mon', ms: 12 }, { day: 'Tue', ms: 18 }],
  x: { field: 'day' },
  series: [{ field: 'ms', label: 'ms' }],
  actions: ['expand'] as const
}

function renderTurn(input: { turn: Turn; isProcessing?: boolean }): string {
  return renderToStaticMarkup(createElement(ConversationTurn, {
    turn: input.turn,
    isProcessing: input.isProcessing ?? false,
    liveReasoning: '',
    live: '',
    filePreviewWorkspaceRoot: '/workspace',
    viewportRef: { current: null },
    allowMainThreadActions: false
  }))
}

describe('ConversationTurn chart display order', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useChatStore.setState({
      route: 'chat',
      busy: false,
      activeThreadGoal: null
    })
  })

  it('renders the assistant conclusion before the chart', () => {
    const html = renderTurn({
      turn: {
        user: { kind: 'user', id: 'user', turnId: 'turn-1', text: 'Show latency' },
        blocks: [
          {
            kind: 'chart',
            id: 'chart_1',
            turnId: 'turn-1',
            spec: { ...chartSpec, actions: [...chartSpec.actions] }
          },
          { kind: 'assistant', id: 'answer', turnId: 'turn-1', text: 'Latency rose this week.' }
        ]
      }
    })
    const answerAt = html.indexOf('Latency rose this week.')
    const chartAt = html.indexOf('data-chart-renderer')
    expect(answerAt).toBeGreaterThan(-1)
    expect(chartAt).toBeGreaterThan(answerAt)
  })

  it('shows a skeleton for in-flight render_chart instead of a process tool card', () => {
    const html = renderTurn({
      isProcessing: true,
      turn: {
        blocks: [{
          kind: 'tool',
          id: 'chart_running',
          summary: 'render_chart',
          status: 'running',
          toolKind: 'tool_call',
          meta: { toolName: 'render_chart' }
        }]
      }
    })
    expect(html).toContain('data-chart-skeleton')
    expect(html).not.toContain('data-chart-renderer')
  })
})
