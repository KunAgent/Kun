import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceHistoryCard, SourceHistoryTurnLabel } from './SourceHistoryCard'

const state = vi.hoisted(() => ({ enabled: false, request: vi.fn(), branch: vi.fn(), getState: vi.fn() }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => state.enabled }))
vi.mock('./history-reference-api', () => ({ historyRequest: state.request, createReferenceBranch: state.branch }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: state.getState } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => { state.enabled = false; state.request.mockReset(); state.branch.mockReset(); state.getState.mockReset(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined })

describe('source reference availability', () => {
  it('never reads Codex history while laboratory access is disabled', async () => {
    await act(async () => { renderer = create(createElement(SourceHistoryCard, { referenceId: 'source-1' })) })
    expect(state.request).not.toHaveBeenCalled()
    expect(JSON.stringify(renderer!.toJSON())).toContain('codexHistoryDisabled')
  })
  it('fetches source metadata on explicit enable and reports missing source without replacing new messages', async () => {
    state.enabled = true
    state.request.mockResolvedValue({ reference: { title: 'Old task', files: [], warnings: [] }, status: 'missing' })
    await act(async () => { renderer = create(createElement(SourceHistoryCard, { referenceId: 'source-1' })) })
    expect(state.request).toHaveBeenCalledWith('/v1/history-sources/source-1', undefined, expect.any(AbortSignal))
    expect(JSON.stringify(renderer!.toJSON())).toContain('codexHistoryStatus_missing')
  })
})


describe('source turn branching workspace', () => {
  it('uses the selected branch workspace when the global project points elsewhere', async () => {
    state.enabled = true
    const refreshThreads = vi.fn().mockResolvedValue(undefined)
    const selectThread = vi.fn().mockResolvedValue(undefined)
    state.getState.mockReturnValue({
      activeThreadId: 'branch-b', workspaceRoot: '/project-a',
      threads: [{ id: 'branch-b', workspace: '/project-b', historyRefId: 'source-b' }],
      composerModel: 'model-b', composerProviderId: 'provider-b', refreshThreads, selectThread
    })
    state.branch.mockResolvedValue({ thread: { id: 'new-b' } })
    await act(async () => { renderer = create(createElement(SourceHistoryTurnLabel, { referenceId: 'source-b', turnId: 'codex:1' })) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(state.branch).toHaveBeenCalledWith(expect.objectContaining({
      workspace: '/project-b', referenceId: 'source-b', cutoffTurnId: 'codex:1', model: 'model-b', providerId: 'provider-b'
    }))
    expect(selectThread).toHaveBeenCalledWith('new-b')
  })
  it('omits a workspace override when the selected branch has no workspace', async () => {
    state.enabled = true
    state.getState.mockReturnValue({ activeThreadId: 'branch', workspaceRoot: '/unrelated',
      threads: [{ id: 'branch', historyRefId: 'source' }], refreshThreads: vi.fn(), selectThread: vi.fn() })
    state.branch.mockResolvedValue({ thread: { id: 'new' } })
    await act(async () => { renderer = create(createElement(SourceHistoryTurnLabel, { referenceId: 'source', turnId: 'codex:1' })) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(state.branch.mock.calls[0]?.[0]).not.toHaveProperty('workspace')
  })
})
