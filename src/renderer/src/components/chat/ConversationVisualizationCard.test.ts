import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import { ConversationVisualizationCard } from './ConversationVisualizationCard'

const block: ToolBlock = {
  kind: 'tool',
  id: 'visualization-call',
  summary: 'show_visualization',
  status: 'success',
  toolKind: 'tool_call',
  meta: {
    toolName: 'show_visualization',
    conversationVisualization: {
      version: 1,
      title: 'Release pipeline',
      sections: [
        {
          kind: 'flow',
          direction: 'horizontal',
          steps: [
            { id: 'build', title: 'Build' },
            { id: 'ship', title: 'Ship', tone: 'success' }
          ]
        },
        {
          kind: 'callout',
          tone: 'warning',
          lines: ['Keep one deployment active.']
        },
        {
          kind: 'card_grid',
          columns: 2,
          cards: [
            { id: 'pass', title: '98%', description: 'Checks that succeeded across the last twenty deploys in this environment.' },
            { id: 'fail', title: 'Two failures', description: 'Need a follow-up review.' }
          ]
        }
      ]
    }
  }
}

describe('ConversationVisualizationCard', () => {
  it('renders semantic flow and callout content', () => {
    const markup = renderToStaticMarkup(createElement(ConversationVisualizationCard, { block }))
    expect(markup).toContain('<figure')
    expect(markup).toContain('<ol')
    expect(markup).toContain('Release pipeline')
    expect(markup).toContain('Build')
    expect(markup).toContain('Keep one deployment active.')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('text-[22px]')
    expect(markup).toContain('line-clamp-2')
    expect(markup).toContain('98%')
    expect(markup).toContain('Two failures')
  })

  it('fails closed without valid visualization metadata', () => {
    const invalid = { ...block, meta: { toolName: 'show_visualization' } }
    expect(renderToStaticMarkup(createElement(ConversationVisualizationCard, { block: invalid }))).toBe('')
  })
})
