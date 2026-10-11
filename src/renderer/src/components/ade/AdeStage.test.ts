import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../workbench/WorkbenchConversationStage', async () => {
  const { createElement: element } = await import('react')
  return {
    WorkbenchConversationStage: ({ mode }: { mode: string }) => element('section', {
      'data-ade-conversation-stage': mode
    })
  }
})

import { AdeStage } from './AdeStage'
import type { WorkbenchConversationStageProps } from '../workbench/WorkbenchConversationStage'

const conversation = {
  chat: { terminalOpen: false }
} as WorkbenchConversationStageProps

describe('AdeStage', () => {
  it('shows the conversation composer for a new unsent ADE draft', () => {
    const html = renderToStaticMarkup(createElement(AdeStage, {
      conversation, activeThreadId: null, adeDraftOpen: true
    }))
    expect(html).toContain('data-ade-conversation-stage="ade"')
  })

  it('keeps Mission Control as the no-thread, no-draft home', () => {
    const html = renderToStaticMarkup(createElement(AdeStage, {
      conversation, activeThreadId: null, adeDraftOpen: false
    }))
    expect(html).toContain('ds-chat-stage')
    expect(html).not.toContain('data-ade-conversation-stage')
  })
})
