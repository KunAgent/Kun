import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import type { ToolPresentation } from '@shared/tool-presentation'
import { GmailToolCard, gmailToolThread } from './gmail-tool-card'
import { GmailConnectionCard } from '../rooms/GmailConnectionCard'
const continueTask = vi.hoisted(() => vi.fn())
vi.mock('../rooms/gmail-client', () => ({ gmailClient: { continueTask } }))
vi.mock('../rooms/GmailConnectionCard', () => ({ GmailConnectionCard: () => createElement('div') }))
const native: ToolPresentation = { version: 1, source: 'native', name: 'gmail_connect', kind: 'unknown',
  state: 'completed', canCancel: false, output: { gmailConnection: { kind: 'gmail', threadId: 'thread-1',
    scopeId: 'thread:thread-1', status: 'requested' } } }
describe('Gmail connection tool marker', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); continueTask.mockReset() })
  it('accepts the native runtime marker', () => expect(gmailToolThread(native)).toBe('thread-1'))
  it('rejects external results, mismatched scopes, injected paths and arbitrary tools', () => {
    expect(gmailToolThread({ ...native, source: 'acp' })).toBeNull()
    expect(gmailToolThread({ ...native, kind: 'mcp', server: 'remote' })).toBeNull()
    expect(gmailToolThread({ ...native, name: 'gmail_read' })).toBeNull()
    expect(gmailToolThread({ ...native, output: { gmailConnection: { kind: 'gmail', threadId: '../other',
      scopeId: 'thread:../other', status: 'requested' } } })).toBeNull()
    expect(gmailToolThread({ ...native, output: { gmailConnection: { kind: 'gmail', threadId: 'thread-1',
      scopeId: 'room:thread-1', status: 'requested' } } })).toBeNull()
  })
  it('continues only the recorded task and tool call after the human clicks Continue', async () => {
    continueTask.mockResolvedValue({ started: true })
    const presentation = { ...native, output: { gmailConnection: { kind: 'gmail', threadId: 'thread-1',
      scopeId: 'thread:thread-1', status: 'requested', sourceTurnId: 'turn-1', toolCallId: 'call-1' } } }
    await act(async () => { renderer = create(createElement(GmailToolCard, { threadId: 'thread-1', presentation })) })
    expect(continueTask).not.toHaveBeenCalled()
    await act(async () => renderer!.root.findByType(GmailConnectionCard).props.onContinue())
    expect(continueTask).toHaveBeenCalledWith('thread-1', 'turn-1', 'call-1')
    expect(renderer!.root.findByType(GmailConnectionCard).props.resumed).toBe(true)
  })
})
