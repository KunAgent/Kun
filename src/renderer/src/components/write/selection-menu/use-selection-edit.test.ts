import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSelectionEdit, type SelectionEditController } from './use-selection-edit'
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: object) => key + (values ? JSON.stringify(values) : '') }) }))
let renderer: ReactTestRenderer | null = null
const request = vi.fn()
beforeEach(() => { request.mockReset(); vi.stubGlobal('window', { kunGui: { requestWriteInlineCompletion: request } }) })
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals() })
const original = 'Original text.'
const selection = { text: original, charCount: original.length, ranges: [{ from: 0, to: original.length,
  text: original, charCount: original.length, startLine: 1, endLine: 1, startColumn: 1, endColumn: original.length }] }
async function harness() {
  const handle = { beginSelectionReview: vi.fn(() => ({ hunks: 2 })), beginDiffReview: vi.fn(() => true),
    isDiffReviewActive: vi.fn(() => false), acceptAllDiff: vi.fn(), rejectAllDiff: vi.fn(),
    getReviewAnchorRect: vi.fn(() => null), subscribeReviewLayout: vi.fn(() => () => {}),
    setSelectionHold: vi.fn(), restoreSelection: vi.fn(), getElement: vi.fn(() => null), undoLast: vi.fn(() => true) }
  const options = { documentKey: 'a', filePath: '/a.md', workspaceRoot: '/', fileContent: original, selection, readOnly: false,
    recentEdits: [], getHandle: () => handle, getEditContent: () => original,
    setSelection: vi.fn(), setError: vi.fn(), toChat: vi.fn(), recordEdits: vi.fn() }
  let controller!: SelectionEditController
  function Host({ id = 'a' }: { id?: string }) { controller = useSelectionEdit({ ...options, documentKey: id }); return null }
  await act(async () => { renderer = create(createElement(Host)) })
  return { options, handle, current: () => controller, switchFile: async () => { await act(async () => renderer!.update(createElement(Host, { id: 'b' }))) } }
}
const result = (text = 'Improved text.') => ({ ok: true, completion: text, action: { kind: 'edit', replacement: text } })
describe('selection edit lifecycle', () => {
  it('proposes without recording changes and records only after acceptance', async () => {
    request.mockResolvedValue(result())
    const h = await harness()
    await act(async () => h.current().start({ instruction: 'Polish' }))
    expect(h.current().session?.phase).toBe('review')
    expect(h.options.recordEdits).not.toHaveBeenCalled()
    await act(async () => h.current().accept())
    expect(h.handle.acceptAllDiff).toHaveBeenCalledOnce()
    expect(h.options.recordEdits).toHaveBeenCalledOnce()
    expect(h.current().session).toBeNull()
  })
  it('ignores a late result after stop and restores the selection', async () => {
    let resolve!: (value: ReturnType<typeof result>) => void
    request.mockImplementation(() => new Promise((done) => { resolve = done }))
    const h = await harness()
    let pending!: Promise<void>
    await act(async () => { pending = h.current().start({ instruction: 'Polish' }) })
    expect(h.current().session?.phase).toBe('running')
    await act(async () => h.current().stop())
    await act(async () => { resolve(result()); await pending })
    expect(h.handle.beginSelectionReview).not.toHaveBeenCalled()
    expect(h.options.setSelection).toHaveBeenCalledWith(selection)
    expect(h.current().session).toBeNull()
  })
  it('invalidates a pending request when the document changes', async () => {
    let resolve!: (value: ReturnType<typeof result>) => void
    request.mockImplementation(() => new Promise((done) => { resolve = done }))
    const h = await harness()
    let pending!: Promise<void>
    await act(async () => { pending = h.current().start({ instruction: 'Polish' }) })
    await h.switchFile()
    await act(async () => { resolve(result()); await pending })
    expect(h.handle.beginSelectionReview).not.toHaveBeenCalled()
    expect(h.current().session).toBeNull()
  })
  it('retries against the same baseline and includes the previous proposal in follow-up', async () => {
    request.mockResolvedValue(result())
    const h = await harness()
    await act(async () => h.current().start({ instruction: 'Polish', label: 'Polish' }))
    await act(async () => h.current().retry())
    expect(h.handle.rejectAllDiff).toHaveBeenCalledOnce()
    expect(request.mock.calls[1][0].editCandidate.original).toBe(original)
    await act(async () => h.current().followUp('Shorter'))
    expect(request.mock.calls[2][0].policy.instruction).toContain('Improved text.')
    expect(request.mock.calls[2][0].policy.instruction).toContain('Shorter')
    expect(h.current().session?.baseline).toBe(original)
  })
  it('discards before handing the original selection and instruction to chat', async () => {
    request.mockResolvedValue(result())
    const h = await harness()
    await act(async () => h.current().start({ instruction: 'Polish' }))
    await act(async () => h.current().toChat())
    expect(h.options.toChat).toHaveBeenCalledWith('Polish', selection)
    expect(h.handle.rejectAllDiff.mock.invocationCallOrder[0]).toBeLessThan(h.options.toChat.mock.invocationCallOrder[0])
    expect(h.handle.acceptAllDiff).not.toHaveBeenCalled()
  })
  it('does not start review for empty or leaked protocol results', async () => {
    const h = await harness()
    for (const text of ['', '<<<EDIT invalid >>>']) {
      request.mockResolvedValue(result(text))
      await act(async () => h.current().start({ instruction: 'Polish' }))
      expect(h.current().session).toBeNull()
    }
    expect(h.handle.beginSelectionReview).not.toHaveBeenCalled()
    expect(h.options.setError).toHaveBeenCalledWith('writeInlineEditEmpty')
  })
  it('does not reject a later agent review on unmount after an accepted edit', async () => {
    request.mockResolvedValue(result())
    const h = await harness()
    await act(async () => h.current().start({ instruction: 'Polish' }))
    await act(async () => h.current().accept())
    await h.switchFile()
    expect(h.handle.rejectAllDiff).not.toHaveBeenCalled()
  })
})
