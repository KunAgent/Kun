import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { MemoryHistory } from './MemoryHistory'
import type { CoreMemoryHistoryJson } from '../../agent/kun-contract'
const history: CoreMemoryHistoryJson[] = [{ revision: 1, changedAt: '2026-10-01T00:00:00Z', operation: 'update', snapshot: { content: 'Earlier content' } }]
describe('progressive memory history loading', () => {
  let renderer: ReactTestRenderer
  beforeEach(async () => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); await i18n.changeLanguage('en') })
  afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('loads only on open, deduplicates repeated toggles and reuses the same selected revision on reopen', async () => {
    let finish!: (value: CoreMemoryHistoryJson[]) => void
    const loadHistory = vi.fn().mockReturnValue(new Promise<CoreMemoryHistoryJson[]>((resolve) => { finish = resolve }))
    await act(async () => { renderer = create(createElement(MemoryHistory, { content: 'Current content', busy: false, loadHistory })) })
    expect(loadHistory).not.toHaveBeenCalled()
    const toggle = renderer.root.findByProps({ className: 'memory-history' }).props.onToggle
    act(() => { toggle({ currentTarget: { open: true } }); toggle({ currentTarget: { open: false } }); toggle({ currentTarget: { open: true } }) })
    expect(loadHistory).toHaveBeenCalledOnce()
    await act(async () => finish(history))
    const toggleAgain = renderer.root.findByProps({ className: 'memory-history' }).props.onToggle
    act(() => { toggleAgain({ currentTarget: { open: false } }); toggleAgain({ currentTarget: { open: true } }) })
    expect(loadHistory).toHaveBeenCalledOnce()
    expect(JSON.stringify(renderer.toJSON())).toContain('Revision 1')
  })
  it('keeps a failed history read retryable without overwriting or changing current memory', async () => {
    const loadHistory = vi.fn().mockRejectedValueOnce(new Error('History unavailable')).mockResolvedValue(history)
    await act(async () => { renderer = create(createElement(MemoryHistory, { content: 'Current content', busy: false, loadHistory })) })
    await act(async () => renderer.root.findByProps({ className: 'memory-history' }).props.onToggle({ currentTarget: { open: true } }))
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('History unavailable')
    await act(async () => renderer.root.findAllByType('button').find((node) => node.children.includes('Reload latest'))!.props.onClick())
    expect(loadHistory).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(renderer.toJSON())).toContain('Revision 1')
  })
})
