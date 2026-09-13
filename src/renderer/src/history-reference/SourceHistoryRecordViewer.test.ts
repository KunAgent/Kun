import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceHistoryRecordViewer, sourceHistoryRecords } from './SourceHistoryRecordViewer'
import type { ChatBlock } from '../agent/types'
import { useThreadTurnTarget } from '../components/chat/thread-turn-target'

const state = vi.hoisted(() => ({ enabled: true, request: vi.fn() }))
vi.mock('../agent/registry', () => ({ getProvider: vi.fn() }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: vi.fn() } }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => state.enabled }))
vi.mock('./history-reference-api', () => ({ historyRequest: state.request }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const itemId = 'codex:session:record-1'
const turnId = 'codex:session:turn-1'
const blocks: ChatBlock[] = [{ kind: 'tool', id: 'merged-call', turnId,
  summary: 'shell', detail: 'truncated preview', status: 'success', meta: { sourceItemId: itemId } }]
let renderer: ReactTestRenderer | undefined
beforeEach(() => { state.enabled = true; state.request.mockReset(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined; useThreadTurnTarget.setState({ target: null }) })
const button = (label: string) => renderer!.root.findAllByType('button').find((node) => node.children.includes(label))!
const page = (text: string, offset: number, nextOffset?: number) => ({
  status: 'available', warnings: [], turns: [], hasMore: false,
  content: { itemId, field: 'output', text, offset, totalChars: 20_000, ...(nextOffset === undefined ? {} : { nextOffset }) }
})
async function mount(referenceId = 'reference-1'): Promise<void> {
  await act(async () => { renderer = create(createElement(SourceHistoryRecordViewer, { blocks, referenceId })) })
  await act(async () => { renderer!.root.findByProps({ 'aria-expanded': false }).props.onClick() })
}

describe('source record viewer', () => {
  it('reads more than 16 KiB through bounded next/previous segments without retaining earlier text', async () => {
    state.request.mockResolvedValueOnce(page('A'.repeat(16_384), 0, 16_384))
      .mockResolvedValueOnce(page('B'.repeat(3_616), 16_384))
      .mockResolvedValueOnce(page('A'.repeat(16_384), 0, 16_384))
    await mount()
    expect(state.request).not.toHaveBeenCalled()
    await act(async () => { renderer!.root.findByProps({ title: itemId }).props.onClick() })
    expect(renderer!.root.findByType('pre').children).toEqual(['A'.repeat(16_384)])
    await act(async () => { button('codexHistoryRecordNext').props.onClick() })
    expect(renderer!.root.findByType('pre').children).toEqual(['B'.repeat(3_616)])
    expect(button('codexHistoryRecordNext').props.disabled).toBe(true)
    expect(button('codexHistoryRecordPrevious').props.disabled).toBe(false)
    const requestUrl = new URL(state.request.mock.calls[1]![0], 'http://localhost')
    expect(requestUrl.pathname).toBe('/v1/history-sources/reference-1/timeline')
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ itemId, turnId, contentOffset: '16384', limit: '1' })
    await act(async () => { button('codexHistoryRecordPrevious').props.onClick() })
    expect(renderer!.root.findByType('pre').children).toEqual(['A'.repeat(16_384)])
    expect(new URL(state.request.mock.calls[2]![0], 'http://localhost').searchParams.get('contentOffset')).toBe('0')
  })

  it('aborts an in-flight read and clears the segment when the viewer closes', async () => {
    let resolve!: (value: unknown) => void
    state.request.mockReturnValue(new Promise((done) => { resolve = done }))
    await mount()
    await act(async () => { renderer!.root.findByProps({ title: itemId }).props.onClick() })
    const signal = state.request.mock.calls[0]![2] as AbortSignal
    expect(signal.aborted).toBe(false)
    await act(async () => { renderer!.root.findByProps({ 'aria-expanded': true }).props.onClick() })
    expect(signal.aborted).toBe(true)
    await act(async () => { resolve(page('late response', 0)) })
    expect(renderer!.root.findAllByType('pre')).toHaveLength(0)
  })

  it('does not read source records when the laboratory feature is disabled', async () => {
    state.enabled = false
    await mount()
    expect(renderer!.root.findByProps({ title: itemId }).props.disabled).toBe(true)
    await act(async () => { renderer!.root.findByProps({ title: itemId }).props.onClick() })
    expect(state.request).not.toHaveBeenCalled()
  })

  it('reports unavailable source content instead of showing a stale segment', async () => {
    state.request.mockResolvedValue({ turns: [], hasMore: false, status: 'missing', warnings: ['Source was removed'] })
    await mount()
    await act(async () => { renderer!.root.findByProps({ title: itemId }).props.onClick() })
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toEqual(['Source was removed'])
    expect(renderer!.root.findAllByType('pre')).toHaveLength(0)
  })

  it('automatically selects and opens the original record requested by a history jump', async () => {
    state.request.mockResolvedValue(page('Exact original tool result', 0))
    useThreadTurnTarget.setState({ target: { threadId: 'thread', turnId, itemId, blocks, revision: 10 } })
    await act(async () => { renderer = create(createElement(SourceHistoryRecordViewer, {
      blocks, referenceId: 'reference-1', threadId: 'thread'
    })) })
    expect(renderer!.root.findByProps({ 'aria-expanded': true })).toBeDefined()
    expect(renderer!.root.findByType('pre').children).toEqual(['Exact original tool result'])
    expect(renderer!.root.findByProps({ title: itemId }).props['aria-pressed']).toBe(true)
    const url = new URL(state.request.mock.calls[0]![0], 'http://localhost')
    expect(url.searchParams.get('itemId')).toBe(itemId)
    await act(async () => { renderer!.update(createElement(SourceHistoryRecordViewer, {
      blocks: [...blocks], referenceId: 'reference-1', threadId: 'thread'
    })) })
    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('does not follow an item target from another thread', async () => {
    useThreadTurnTarget.setState({ target: { threadId: 'other-thread', turnId, itemId, blocks, revision: 10 } })
    await act(async () => { renderer = create(createElement(SourceHistoryRecordViewer, {
      blocks, referenceId: 'reference-1', threadId: 'thread'
    })) })
    expect(state.request).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ 'aria-expanded': false })).toBeDefined()
  })

  it('addresses original tool-result IDs and ignores native conversation blocks', () => {
    expect(sourceHistoryRecords([...blocks, { kind: 'assistant', id: 'native-item', turnId: 'native-turn', text: 'new' }]))
      .toEqual([{ itemId, turnId, kind: 'tool', label: 'shell' }])
  })
})
