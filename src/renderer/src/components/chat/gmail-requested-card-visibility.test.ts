import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { ConversationTurn } from './message-timeline-conversation-turn'

function connectionBlock(id = 'gmail-card'): ToolBlock {
  return { kind: 'tool', id, summary: 'gmail_connect', status: 'success', meta: {
    toolPresentation: { version: 1, source: 'native', name: 'gmail_connect', kind: 'unknown',
      state: 'completed', canCancel: false, output: { gmailConnection: { kind: 'gmail',
        threadId: 'thread-1', scopeId: 'thread:thread-1', status: 'requested',
        sourceTurnId: 'turn-1', toolCallId: id } } }
  } }
}

function render(blocks: ChatBlock[]): string {
  return renderToStaticMarkup(createElement(ConversationTurn, {
    turn: { blocks }, isProcessing: false, liveReasoning: '', live: '', durationMs: 21_000,
    filePreviewWorkspaceRoot: '/tmp', viewportRef: { current: null }, threadId: 'thread-1'
  }))
}

describe('Gmail requested card outside completed work folds', () => {
  beforeEach(() => useChatStore.setState({ route: 'chat', activeThreadId: 'thread-1', busy: false,
    threads: [{ id: 'thread-1', title: 'Gmail', model: 'deepseek-chat', mode: 'code',
      updatedAt: '2026-10-13T00:00:00.000Z', workspace: '/tmp' }] }))

  it('shows the connection control while unrelated completed tool details stay folded', () => {
    const html = render([
      { kind: 'tool', id: 'other-tool', summary: 'read', status: 'success', detail: 'unrelated private detail' },
      connectionBlock(), { kind: 'assistant', id: 'answer', text: 'Connect Gmail to continue.' }
    ])
    expect(html).toContain('gmail-connection-card')
    expect(html).not.toContain('unrelated private detail')
    expect(html.match(/class="[^"]*gmail-connection-card/g)).toHaveLength(1)
  })

  it('shows the latest control once in a folded guided-input segment', () => {
    const html = render([
      { kind: 'user', id: 'q-guide-1', turnId: 'turn-1', text: 'Use Gmail' },
      connectionBlock('first-call'), connectionBlock('second-call'),
      { kind: 'assistant', id: 'answer', text: 'Please connect.' }
    ])
    expect(html).toContain('Use Gmail')
    expect(html).toContain('gmail-connection-card')
    expect(html.match(/class="[^"]*gmail-connection-card/g)).toHaveLength(1)
  })

  it('does not expose a Gmail control for an external server impersonating the native marker', () => {
    const block = connectionBlock()
    block.meta!.toolPresentation = { ...(block.meta!.toolPresentation as Record<string, unknown>), source: 'acp' }
    expect(render([block, { kind: 'assistant', id: 'answer', text: 'Done.' }])).not.toContain('gmail-connection-card')
  })
})
