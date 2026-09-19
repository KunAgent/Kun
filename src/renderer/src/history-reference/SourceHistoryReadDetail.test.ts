import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceHistoryReadDetail, sourceReadTargets } from './SourceHistoryReadDetail'
import { useThreadTurnTarget } from '../components/chat/thread-turn-target'
import { useCodexReferenceState } from './codex-reference-state'

const state = vi.hoisted(() => ({ threadId: 'thread', enabled: true, getThreadDetail: vi.fn() }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: () => ({ activeThreadId: state.threadId }) } }))
vi.mock('../agent/registry', () => ({ getProvider: () => ({ getThreadDetail: state.getThreadDetail }) }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => state.enabled }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  state.threadId = 'thread'; state.enabled = true; state.getThreadDetail.mockReset()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined; useThreadTurnTarget.setState({ target: null })
  useCodexReferenceState.setState({ enabled: null, revision: 0 }); vi.unstubAllGlobals()
})

describe('historical tool-result navigation', () => {
  it('retains each item pointer even when multiple excerpts belong to the same turn', () => {
    const text = '[codex:session:turn-1 / item-1 / user_message]\nPrompt\n\n[ codex:invalid / item / x]\n[normal / item / x]\n[codex:session:turn-1 / item-2 / assistant_text]\nAnswer\n[codex:session:turn-1 / item-1 / user_message]\nPrompt again\n[codex:session:turn-2 / item-3 / user_message]\nNext'
    expect(sourceReadTargets(JSON.stringify({ text }))).toEqual([
      { turnId: 'codex:session:turn-1', itemId: 'item-1' },
      { turnId: 'codex:session:turn-1', itemId: 'item-2' },
      { turnId: 'codex:session:turn-2', itemId: 'item-3' }
    ])
  })
  it('leaves a failed or unrelated tool response without history navigation', () => {
    expect(sourceReadTargets(JSON.stringify({ error: 'missing source' }))).toEqual([])
    expect(sourceReadTargets('Source unavailable')).toEqual([])
  })
  it('opens the requested early record of a 131-item turn and retains its next-page cursor', async () => {
    const turnId = 'codex:session:turn-1'
    const records = Array.from({ length: 131 }, (_, index) => ({
      kind: index === 0 ? 'user' : 'assistant', id: `item-${index}`, turnId,
      text: index === 0 ? 'Earliest user request' : `Answer ${index}`,
      sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: index }
    }))
    state.getThreadDetail.mockImplementation(async (_threadId, options) => ({
      latestSeq: 42, latestTurnId: 'native-latest',
      blocks: options.itemId === 'item-0' ? records.slice(0, 100) : records.slice(-100),
      historyTarget: { turnId, itemId: options.itemId, nextCursor: 'target-next' }
    }))
    await act(async () => { renderer = create(createElement(SourceHistoryReadDetail, { block: {
      kind: 'tool', id: 'read', summary: 'read_source_history', status: 'success',
      detail: `[${turnId} / item-0 / user_message]\nEarliest user request`
    } })) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(state.getThreadDetail).toHaveBeenCalledWith('thread', { turnId, itemId: 'item-0', priority: 'foreground' })
    expect(useThreadTurnTarget.getState().target).toMatchObject({
      threadId: 'thread', turnId, itemId: 'item-0',
      historyTarget: { turnId, itemId: 'item-0', nextCursor: 'target-next' }
    })
    expect(useThreadTurnTarget.getState().target?.blocks[0]).toMatchObject({ id: 'item-0', text: 'Earliest user request' })
  })
  it('does not accept a turn page that omitted the requested item', async () => {
    state.getThreadDetail.mockResolvedValue({ latestSeq: 1, blocks: [
      { kind: 'assistant', id: 'later', turnId: 'codex:turn', text: 'later page' }
    ] })
    await act(async () => { renderer = create(createElement(SourceHistoryReadDetail, { block: {
      kind: 'tool', id: 'read', summary: 'read_source_history', status: 'success',
      detail: '[codex:turn / early / user_message]\nPrompt'
    } })) })
    await act(async () => { renderer!.root.findByType('button').props.onClick() })
    expect(useThreadTurnTarget.getState().target).toBeNull()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('unavailable')
  })
})
