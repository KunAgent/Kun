import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { createElement } from 'react'
import type { ToolPresentation } from '@shared/tool-presentation'
import { GitHubToolCard, githubToolThread } from './github-tool-card'
import { GitHubConnectionCard } from '../rooms/GitHubConnectionCard'
const continueTask = vi.hoisted(() => vi.fn())
vi.mock('../rooms/github-app-client', () => ({ githubAppClient: { continueTask } }))
vi.mock('../rooms/GitHubConnectionCard', () => ({ GitHubConnectionCard: () => createElement('div') }))
const native: ToolPresentation = { version: 1, source: 'native', name: 'github_connect', kind: 'unknown',
  state: 'completed', canCancel: false, output: { githubConnection: { kind: 'github', threadId: 'thread-1',
    scopeId: 'thread:thread-1', status: 'requested' } } }
describe('GitHub connection tool marker', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => { if (renderer) act(() => renderer?.unmount()); continueTask.mockReset() })
  it('accepts the native runtime marker', () => expect(githubToolThread(native)).toBe('thread-1'))
  it('rejects external results, mismatched scopes, injected paths and arbitrary tools', () => {
    expect(githubToolThread({ ...native, source: 'acp' })).toBeNull()
    expect(githubToolThread({ ...native, kind: 'mcp', server: 'remote' })).toBeNull()
    expect(githubToolThread({ ...native, name: 'github_read' })).toBeNull()
    expect(githubToolThread({ ...native, output: { githubConnection: { kind: 'github', threadId: '../other',
      scopeId: 'thread:../other', status: 'requested' } } })).toBeNull()
    expect(githubToolThread({ ...native, output: { githubConnection: { kind: 'github', threadId: 'thread-1',
      scopeId: 'room:thread-1', status: 'requested' } } })).toBeNull()
  })
  it('continues only the recorded task and tool call after the human clicks Continue', async () => {
    continueTask.mockResolvedValue({ started: true })
    const presentation = { ...native, output: { githubConnection: { kind: 'github', threadId: 'thread-1',
      scopeId: 'thread:thread-1', status: 'requested', sourceTurnId: 'turn-1', toolCallId: 'call-1' } } }
    await act(async () => { renderer = create(createElement(GitHubToolCard, { threadId: 'thread-1', presentation })) })
    expect(continueTask).not.toHaveBeenCalled()
    await act(async () => renderer!.root.findByType(GitHubConnectionCard).props.onContinue())
    expect(continueTask).toHaveBeenCalledWith('thread-1', 'turn-1', 'call-1')
    expect(renderer!.root.findByType(GitHubConnectionCard).props.resumed).toBe(true)
  })
})
