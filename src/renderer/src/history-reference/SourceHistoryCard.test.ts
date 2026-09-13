import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceHistoryCard } from './SourceHistoryCard'

const state = vi.hoisted(() => ({ enabled: false, request: vi.fn() }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => state.enabled }))
vi.mock('./history-reference-api', () => ({ historyRequest: state.request, createReferenceBranch: vi.fn() }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => { state.enabled = false; state.request.mockReset(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })
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
