import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkingContextPanel } from './MemoryWorkingContextPanel'
import { previewRuntimeMemoryContext } from '../../agent/kun-runtime-memory-context'
import type { MemoryWorkingContextPreview } from '@shared/memory-working-context'

vi.mock('../../agent/kun-runtime-memory-context', () => ({ previewRuntimeMemoryContext: vi.fn() }))
vi.mock('./MemoryRelationAnnotations', () => ({ MemoryRelationAnnotations: () => null }))
const result: MemoryWorkingContextPreview = { memories: [], referenceBlocks: [], characterCount: 0, characterBudget: 6000,
  relations: { state: 'ready', automaticEnabled: false, annotations: [], block: '', omittedByBudget: 0 } }
describe('read-only Memory context preview UI', () => {
  let renderer: ReactTestRenderer | undefined
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.mocked(previewRuntimeMemoryContext).mockResolvedValue(result)
  })
  afterEach(() => {
    if (renderer) act(() => renderer!.unmount())
    renderer = undefined
    vi.resetAllMocks(); vi.unstubAllGlobals()
  })
  const render = async (enabled = true) => act(async () => {
    renderer = create(createElement(MemoryWorkingContextPanel, { enabled, automaticEnabled: false, t: (key) => key }))
  })
  const fill = async () => act(async () => {
    renderer!.root.findByType('input').props.onChange({ target: { value: '/synthetic-workspace' } })
    renderer!.root.findByType('textarea').props.onChange({ target: { value: 'database' } })
  })
  const click = async (label = 'memoryContextPreview') => act(async () => {
    renderer!.root.findAllByType('button').find((node) => node.children.includes(label))!.props.onClick()
  })
  it('requires an explicit preview and labels the default-off what-if state', async () => {
    await render()
    expect(previewRuntimeMemoryContext).not.toHaveBeenCalled()
    expect(renderer!.root.findByType('button').props.disabled).toBe(true)
    await fill(); await click()
    expect(previewRuntimeMemoryContext).toHaveBeenCalledWith({
      query: 'database', workspace: '/synthetic-workspace'
    }, expect.any(AbortSignal))
    expect(JSON.stringify(renderer!.toJSON())).toContain('memoryContextAutomaticOff')
    expect(JSON.stringify(renderer!.toJSON())).toContain('memoryContextEmpty')
  })
  it('disables preview when master Memory is off', async () => {
    await render(false)
    expect(renderer!.root.findByType('button').props.disabled).toBe(true)
    expect(renderer!.root.findByType('input').props.disabled).toBe(true)
  })
  it('clears stale output on editing and ignores a canceled late response', async () => {
    await render(); await fill(); await click()
    await act(async () => renderer!.root.findByType('textarea').props.onChange({ target: { value: 'different query' } }))
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('memoryContextEmpty')
    let resolve!: (value: MemoryWorkingContextPreview) => void
    vi.mocked(previewRuntimeMemoryContext).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    await click()
    const signal = vi.mocked(previewRuntimeMemoryContext).mock.calls.at(-1)![1]!
    await click('memoryContextCancel')
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(result))
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('memoryContextEmpty')
  })
  it('redacts errors, permits retry and clears results when settings change', async () => {
    await render(); await fill()
    vi.mocked(previewRuntimeMemoryContext).mockRejectedValueOnce(new Error('secret local path'))
    await click()
    expect(JSON.stringify(renderer!.toJSON())).toContain('memoryContextError')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('secret local path')
    await click()
    expect(JSON.stringify(renderer!.toJSON())).toContain('memoryContextEmpty')
    await act(async () => renderer!.update(createElement(MemoryWorkingContextPanel, {
      enabled: true, automaticEnabled: true, t: (key) => key
    })))
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('memoryContextEmpty')
  })
})
