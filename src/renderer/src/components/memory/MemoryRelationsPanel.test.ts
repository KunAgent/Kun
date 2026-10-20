import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRecord } from '../../../../../kun/src/contracts/memory'
import { MemoryRelationsPanel } from './MemoryRelationsPanel'
import { analyzeRuntimeMemoryRelations, requestMemoryRelations } from '../../agent/kun-runtime-memory-relations'

vi.mock('../../agent/kun-runtime-memory-relations', () => ({
  analyzeRuntimeMemoryRelations: vi.fn(), requestMemoryRelations: vi.fn()
}))
vi.mock('./MemoryEvidence', () => ({ MemoryEvidence: () => null }))

const source = MemoryRecord.parse({
  id: 'mem_a', content: 'Use database version 17.', scope: 'user',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z'
})
const target = MemoryRecord.parse({ ...source, id: 'mem_b', content: 'Use database version 16.' })
const entry = {
  suggestion: { id: 'relation_' + 'a'.repeat(64), generator: 'model-relations-v1' as const,
    status: 'pending' as const, createdAt: source.createdAt,
    proposal: { source: { id: source.id, revision: 1, fingerprint: 'a'.repeat(64) },
      target: { id: target.id, revision: 1, fingerprint: 'b'.repeat(64) }, kind: 'contradicts' as const,
      sourceEvidence: { start: 4, end: 23 }, targetEvidence: { start: 4, end: 23 } } },
  source, target, stale: false
}

describe('Memory relation review UI', () => {
  let renderer: ReactTestRenderer | undefined
  const click = async (label: string) => act(async () => {
    renderer!.root.findAllByType('button').find((node) => node.children.includes(label))!.props.onClick()
  })
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.mocked(requestMemoryRelations).mockResolvedValue({ relations: [] })
    vi.mocked(analyzeRuntimeMemoryRelations).mockResolvedValue({ relations: [entry] })
  })
  afterEach(() => {
    if (renderer) act(() => renderer!.unmount())
    renderer = undefined
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })
  const render = async () => act(async () => {
    renderer = create(createElement(MemoryRelationsPanel, { memory: source, t: (key) => key }))
  })

  it('never analyzes on mount/open and requires an explicit model action', async () => {
    await render()
    expect(requestMemoryRelations).not.toHaveBeenCalled()
    await click('memoryRelationsTitle')
    expect(requestMemoryRelations).toHaveBeenCalledOnce()
    expect(analyzeRuntimeMemoryRelations).not.toHaveBeenCalled()
    await click('memoryRelationsAnalyze')
    expect(analyzeRuntimeMemoryRelations).toHaveBeenCalledWith(
      { memoryId: source.id, expectedRevision: 1, access: { workspace: undefined, project: undefined } }, expect.any(AbortSignal))
  })

  it('displays both endpoints and sends only the explicit decision', async () => {
    vi.mocked(requestMemoryRelations).mockResolvedValue({ relations: [entry] })
    await render()
    await click('memoryRelationsTitle')
    expect(renderer!.root.findAllByType('mark')).toHaveLength(2)
    await click('memoryRelationsAccept')
    expect(requestMemoryRelations).toHaveBeenCalledWith({
      action: 'review', id: entry.suggestion.id, decision: 'accepted', access: { workspace: undefined, project: undefined }
    }, expect.any(AbortSignal))
  })

  it('does not display stale quotes or enable a stale decision', async () => {
    vi.mocked(requestMemoryRelations).mockResolvedValue({ relations: [{ ...entry, stale: true }] })
    await render()
    await click('memoryRelationsTitle')
    expect(renderer!.root.findAllByType('mark')).toHaveLength(0)
    expect(renderer!.root.findAllByType('button').some((node) => node.children.includes('memoryRelationsAccept'))).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('memoryRelationsStaleHint')
  })

  it('filters reviewed relations and explicitly withdraws an accepted decision', async () => {
    vi.mocked(requestMemoryRelations).mockResolvedValue({ relations: [
      { ...entry, suggestion: { ...entry.suggestion, status: 'accepted', decidedAt: source.createdAt } }
    ] })
    await render(); await click('memoryRelationsTitle')
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'pending' } }))
    expect(renderer!.root.findAllByType('mark')).toHaveLength(0)
    await act(async () => renderer!.root.findByType('select').props.onChange({ target: { value: 'accepted' } }))
    await click('memoryRelationsWithdraw')
    expect(requestMemoryRelations).toHaveBeenCalledWith({
      action: 'withdraw', id: entry.suggestion.id, access: { workspace: undefined, project: undefined }
    }, expect.any(AbortSignal))
  })

  it('hides cached evidence after failure and supports a fresh read', async () => {
    vi.mocked(requestMemoryRelations).mockResolvedValueOnce({ relations: [entry] })
      .mockRejectedValueOnce(new Error('secret text')).mockResolvedValue({ relations: [] })
    await render()
    await click('memoryRelationsTitle')
    await click('memoryRelationsRefresh')
    expect(renderer!.root.findAllByType('mark')).toHaveLength(0)
    expect(renderer!.root.findByProps({ role: 'alert' }).children).toContain('memoryRelationsError')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('secret text')
    await click('memoryRelationsRefresh')
    expect(renderer!.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })
})
