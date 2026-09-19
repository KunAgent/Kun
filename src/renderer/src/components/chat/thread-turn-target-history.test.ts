import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatBlockFromItem, mergeChatBlocks } from '../../agent/kun-mapper'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import type { ChatBlock } from '../../agent/types'
import { prependOlderHistoryBlocks } from '../../store/chat-store-thread-actions-support'
import { useChatStore } from '../../store/chat-store'
import { useCodexReferenceState } from '../../history-reference/codex-reference-state'
import { activateThreadTurnTarget, loadThreadTurnTargetPage, mergeThreadTurnTarget, useThreadTurnTarget } from './thread-turn-target'
import { deriveTurnSections } from './derive-turn-sections'
import { groupTurns } from './message-timeline-turns'

const provider = vi.hoisted(() => ({ getThreadDetail: vi.fn() }))
vi.mock('../../agent/registry', () => ({ getProvider: () => provider }))
const turnId = 'codex:session:turn-1'
function sourceItem(index: number, kind: CoreTurnItemJson['kind'] = 'assistant_text', extra: Partial<CoreTurnItemJson> = {}): ChatBlock {
  return chatBlockFromItem({ id: `record-${index}`, threadId: 'thread', turnId, kind, role: kind === 'user_message' ? 'user' : 'assistant', status: 'completed', text: `Answer ${index}`,
    createdAt: '2026-09-13T00:00:00Z', sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: index }, ...extra })!
}
afterEach(() => {
  vi.clearAllMocks(); useThreadTurnTarget.setState({ target: null })
  useCodexReferenceState.setState({ enabled: null, revision: 0 })
})

describe('source target history merging', () => {
  it('keeps numeric source order across overlapping target and normal pages, including final-answer selection', () => {
    const source = [sourceItem(1), sourceItem(2), sourceItem(10)]
    const native: ChatBlock[] = [
      { kind: 'assistant', id: 'native-second', turnId: 'native', text: 'native second', createdAt: '2026-09-13T00:00:05Z' },
      { kind: 'assistant', id: 'native-first', turnId: 'native', text: 'native first', createdAt: '2026-09-13T00:00:01Z' }
    ]
    const target = { threadId: 'thread', turnId, blocks: [source[2]!], revision: 1 }
    const merged = mergeThreadTurnTarget([...source, ...native], target, 'thread')
    expect(merged.map((item) => item.id)).toEqual(['record-1', 'record-2', 'record-10', 'native-second', 'native-first'])
    const sections = deriveTurnSections({ turn: groupTurns(merged)[0]!, isProcessing: false,
      liveContent: '', liveProcessText: '', workspaceRoot: '/workspace' })
    expect(sections.assistantContentBlocks.map((item) => item.id)).toEqual(['record-10'])
    expect(sections.processBlocks.map((item) => item.id)).toEqual(['record-1', 'record-2'])
  })
  it('sorts parent and child records by their projected order, and preserves all tool source records', () => {
    const call = sourceItem(2, 'tool_call', { toolName: 'shell', callId: 'call', arguments: { command: 'pwd' } })
    const result = sourceItem(4, 'tool_result', { toolName: 'shell', callId: 'call', output: 'Done' })
    const parent = sourceItem(99, 'assistant_text', { sourceHistoryOrder: { referenceId: 'ref', turnIndex: 0, itemIndex: 99 } })
    const child = sourceItem(1, 'assistant_text', { id: 'child', turnId: 'codex:child',
      sourceHistoryOrder: { referenceId: 'ref', turnIndex: 1, itemIndex: 1 } })
    const merged = mergeChatBlocks([child, result, parent, call])
    expect(merged.map((item) => item.id)).toEqual([call.id, parent.id, child.id])
    expect(merged[0]).toMatchObject({ sourceHistoryOrder: { itemIndex: 2 }, sourceRecords: [
      { itemId: 'record-2', kind: 'tool_call' }, { itemId: 'record-4', kind: 'tool_result' }
    ] })
  })
  it('keeps a previously read tool result when an earlier call-only page arrives later', () => {
    const call = sourceItem(2, 'tool_call', { toolName: 'shell', callId: 'call', arguments: { command: 'pwd' } })
    const result = sourceItem(4, 'tool_result', { toolName: 'shell', callId: 'call', output: 'Final output' })
    const priorTarget = mergeChatBlocks([call, result])
    const merged = mergeThreadTurnTarget([call], { threadId: 'thread', turnId, blocks: priorTarget, revision: 1 }, 'thread')
    expect(merged[0]).toMatchObject({ detail: 'Final output', sourceHistoryOrder: { itemIndex: 2 },
      meta: { sourceItemKind: 'tool_result' }, sourceRecords: [
        { itemId: 'record-2', kind: 'tool_call' }, { itemId: 'record-4', kind: 'tool_result' }
      ] })
  })
  it('keeps a merged source tool at its call position when ordinary earlier-history pagination fills a gap', () => {
    const call = sourceItem(2, 'tool_call', { toolName: 'shell', callId: 'call', arguments: { command: 'pwd' } })
    const result = sourceItem(4, 'tool_result', { toolName: 'shell', callId: 'call', output: 'Final output' })
    const current = [result, sourceItem(5), { kind: 'assistant' as const, id: 'native', text: 'latest' }]
    const merged = prependOlderHistoryBlocks(current, [call, sourceItem(3)])
    expect(merged.map((item) => item.id)).toEqual([call.id, 'record-3', 'record-5', 'native'])
    expect(merged[0]).toMatchObject({ detail: 'Final output', sourceHistoryOrder: { itemIndex: 2 } })
  })
  it('preserves loaded-page ordering for legacy source records with identical times and no ordinal metadata', () => {
    const source = [sourceItem(10), sourceItem(2)].map(({ sourceHistoryOrder: _ignored, ...item }) => item)
    const target = { threadId: 'thread', turnId, blocks: [source[1]!], revision: 1 }
    expect(mergeThreadTurnTarget(source, target, 'thread').map((item) => item.id)).toEqual(['record-10', 'record-2'])
  })
  it('keeps live SSE item IDs out of an old target snapshot', () => {
    const live = { kind: 'assistant' as const, id: 'live', turnId: 'native', text: 'stale stream' }
    expect(mergeThreadTurnTarget([sourceItem(1)], { threadId: 'thread', turnId, blocks: [live], revision: 1 },
      'thread', ['live']).map((block) => block.id)).toEqual(['record-1'])
  })
})

describe('bounded target pagination', () => {
  it('retains both page boundaries and appends target records without replacing live chat state', async () => {
    useChatStore.setState({ activeThreadId: 'thread', blocks: [{ kind: 'assistant', id: 'live', text: 'live' }] })
    activateThreadTurnTarget('thread', turnId, { latestSeq: 12, blocks: [sourceItem(2)],
      historyCursor: 'main-history', historyTarget: { turnId, itemId: 'record-2', previousCursor: 'before', nextCursor: 'after' } })
    const targetRevision = useThreadTurnTarget.getState().target!.revision
    provider.getThreadDetail.mockResolvedValueOnce({ latestSeq: 12, blocks: [sourceItem(1)],
      historyTarget: { turnId, nextCursor: 'middle' } })
    await loadThreadTurnTargetPage('previous')
    expect(provider.getThreadDetail).toHaveBeenCalledWith('thread', { turnId, before: 'before', priority: 'foreground' })
    expect(useThreadTurnTarget.getState().target).toMatchObject({ revision: targetRevision,
      historyTarget: { itemId: 'record-2', nextCursor: 'after', previousCursor: undefined } })
    provider.getThreadDetail.mockResolvedValueOnce({ latestSeq: 12, blocks: [sourceItem(3)],
      historyTarget: { turnId, previousCursor: 'middle' } })
    await loadThreadTurnTargetPage('next')
    expect(useThreadTurnTarget.getState().target?.blocks.map((item) => item.id)).toEqual(['record-1', 'record-2', 'record-3'])
    expect(useChatStore.getState().blocks).toEqual([{ kind: 'assistant', id: 'live', text: 'live' }])
  })
  it('discards a page that completed after the feature setting changed', async () => {
    useChatStore.setState({ activeThreadId: 'thread' })
    useCodexReferenceState.setState({ enabled: true, revision: 1 })
    activateThreadTurnTarget('thread', turnId, { latestSeq: 0, blocks: [sourceItem(1)],
      historyTarget: { turnId, nextCursor: 'after' } })
    let resolve!: (value: unknown) => void
    provider.getThreadDetail.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = loadThreadTurnTargetPage('next')
    useCodexReferenceState.setState({ enabled: false, revision: 2 })
    resolve({ latestSeq: 0, blocks: [sourceItem(2)], historyTarget: { turnId } })
    await pending
    expect(useThreadTurnTarget.getState().target?.blocks.map((item) => item.id)).toEqual(['record-1'])
  })
})
