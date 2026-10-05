import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperMatrixCellEditor } from './PaperMatrixCellEditor'
import { PaperMatrixWorkspace } from './PaperMatrixWorkspace'
import { button, change, click, deferred, entry, evidence, matrix, nodeText, render, unknownCell } from './paper-evidence-test-support'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../paper/paper-evidence-actions', () => ({ inspectPaperEvidence: vi.fn(), paperEvidenceCitation: () => 'citation', paperMatrixMarkdown: () => 'matrix markdown' }))
let tree: ReactTestRenderer | undefined
let api: {
  paperEvidenceRead: ReturnType<typeof vi.fn>; paperMatricesRead: ReturnType<typeof vi.fn>
  paperMatrixCreate: ReturnType<typeof vi.fn>; paperMatrixUpdate: ReturnType<typeof vi.fn>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api = {
    paperEvidenceRead: vi.fn(async () => ({ ok: true, revision: 1, items: [evidence] })),
    paperMatricesRead: vi.fn(async () => ({ ok: true, revision: 1, matrices: [matrix] })),
    paperMatrixCreate: vi.fn(async () => ({ ok: true, revision: 2, matrices: [matrix] })),
    paperMatrixUpdate: vi.fn(async () => ({ ok: true, revision: 2, matrices: [matrix] }))
  }
  vi.stubGlobal('window', { kunGui: api })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('PaperMatrixCellEditor explicit manual claims', () => {
  it('starts unknown, requires both a value and same-paper evidence to report a cell', async () => {
    const otherEvidence = { ...evidence, id: 'other-evidence', unitDir: 'papers/b', originalQuote: 'Other paper quote' }
    const onSave = vi.fn(async () => undefined)
    tree = await render(createElement(PaperMatrixCellEditor, { workspaceRoot: '/library', cell: unknownCell,
      evidence: [evidence, otherEvidence], onSave, onClose: vi.fn() }))
    expect(tree.root.findAllByType('textarea')[0].props.disabled).toBe(true)
    expect(tree.root.findByType('select').props.value).toBe('unknown')
    expect(nodeText(tree.root)).not.toContain('Other paper quote')
    await change(tree.root.findAllByProps({ type: 'checkbox' })[0], false)
    await change(tree.root.findAllByType('textarea')[0], 'Reported method')
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(true)
    await change(tree.root.findAllByProps({ type: 'checkbox' })[1], true)
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(false)
    await click(tree, 'paperEvidenceSaveEdits')
    expect(onSave).toHaveBeenCalledWith({ cells: [{ ...unknownCell, updatedAt: undefined,
      status: 'reported', value: 'Reported method', evidenceIds: [evidence.id] }] })
  })

  it('requires a comparability reason and retains original units and qualifiers in manual content', async () => {
    tree = await render(createElement(PaperMatrixCellEditor, { workspaceRoot: '/library', cell: { ...unknownCell,
      status: 'reported', value: '2.3 ms, not 10%; on split A', evidenceIds: [evidence.id] },
    evidence: [evidence], onSave: vi.fn(), onClose: vi.fn() }))
    await change(tree.root.findByType('select'), 'not-comparable')
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(true)
    await change(tree.root.findAllByType('textarea')[1], 'The dataset split differs')
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(false)
    expect(tree.root.findAllByType('textarea')[0].props.value).toBe('2.3 ms, not 10%; on split A')
  })

  it('clears value, links and comparability when explicitly returning to unknown', async () => {
    const onSave = vi.fn(async () => undefined)
    tree = await render(createElement(PaperMatrixCellEditor, { workspaceRoot: '/library', cell: { ...unknownCell,
      status: 'reported', value: 'Manual value', evidenceIds: [evidence.id], comparability: 'comparable', comparabilityReason: 'Same split' },
    evidence: [evidence], onSave, onClose: vi.fn() }))
    await change(tree.root.findAllByProps({ type: 'checkbox' })[0], true)
    await click(tree, 'paperEvidenceSaveEdits')
    expect(onSave).toHaveBeenCalledWith({ cells: [{ unitDir: unknownCell.unitDir, axis: 'method',
      status: 'not-reported', value: '', evidenceIds: [], comparability: 'unknown', comparabilityReason: '' }] })
  })

  it('cancels an edited cell without persisting and allows clearing an incomplete comparability draft', async () => {
    const onSave = vi.fn(async () => undefined)
    const onClose = vi.fn()
    tree = await render(createElement(PaperMatrixCellEditor, { workspaceRoot: '/library', cell: { ...unknownCell,
      status: 'reported', value: 'Original value', evidenceIds: [evidence.id] }, evidence: [evidence], onSave, onClose }))
    await change(tree.root.findByType('select'), 'not-comparable')
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(true)
    await change(tree.root.findAllByProps({ type: 'checkbox' })[0], true)
    expect(button(tree, 'paperEvidenceSaveEdits').props.disabled).toBe(false)
    await click(tree, 'cancel')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('serializes rapid save clicks and closes only after a successful response', async () => {
    const pending = deferred<void>()
    const onSave = vi.fn(() => pending.promise)
    const onClose = vi.fn()
    tree = await render(createElement(PaperMatrixCellEditor, { workspaceRoot: '/library', cell: unknownCell,
      evidence: [evidence], onSave, onClose }))
    const save = button(tree, 'paperEvidenceSaveEdits').props.onClick
    await act(async () => { save(); save() })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(button(tree, 'close').props.disabled).toBe(true)
    await act(async () => pending.reject(new Error('Revision conflict')))
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['Revision conflict'])
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('PaperMatrixWorkspace persistence', () => {
  it('creates an explicit empty matrix without inventing values or triggering inference', async () => {
    api.paperMatricesRead.mockResolvedValue({ ok: true, revision: 1, matrices: [] })
    tree = await render(createElement(PaperMatrixWorkspace, { workspaceRoot: '/library', selected: [entry], onClose: vi.fn() }))
    await click(tree, 'paperMatrixCreate')
    expect(api.paperMatrixCreate).toHaveBeenCalledWith({ workspaceRoot: '/library', title: 'paperMatrixTitle',
      unitDirs: [entry.unitDir], axes: ['task', 'method', 'dataset', 'metric', 'result', 'conditions', 'limitations'], expectedRevision: 1 })
    const cells = tree.root.findAllByType('td')
    expect(cells).toHaveLength(1)
    expect(nodeText(cells[0])).toContain('paperMatrixUnknown')
    expect(nodeText(cells[0])).not.toContain('paperMatrix_unknown')
    expect(api.paperMatrixUpdate).not.toHaveBeenCalled()
  })

  it('edits and undoes a cell with revision checks; adding rows does not send replacement cell content', async () => {
    const edited = { ...unknownCell, status: 'reported' as const, value: 'Manual method', evidenceIds: [evidence.id], updatedAt: 'later' }
    api.paperMatrixUpdate.mockResolvedValueOnce({ ok: true, revision: 2, matrices: [{ ...matrix, cells: [edited] }] })
    tree = await render(createElement(PaperMatrixWorkspace, { workspaceRoot: '/library', selected: [entry], onClose: vi.fn() }))
    await click(tree, 'paperMatrixUnknown')
    const editor = tree.root.findByType(PaperMatrixCellEditor)
    await change(editor.findAllByProps({ type: 'checkbox' })[0], false)
    await change(editor.findAllByType('textarea')[0], 'Manual method')
    await change(editor.findAllByProps({ type: 'checkbox' })[1], true)
    await click(tree, 'paperEvidenceSaveEdits')
    expect(api.paperMatrixUpdate.mock.calls[0][0]).toMatchObject({ matrixId: matrix.id, expectedRevision: 1,
      patch: { cells: [{ value: 'Manual method', evidenceIds: [evidence.id] }] } })
    await click(tree, 'paperEvidenceUndo')
    expect(api.paperMatrixUpdate.mock.calls[1][0]).toEqual({ workspaceRoot: '/library', matrixId: matrix.id, expectedRevision: 2,
      patch: { cells: [{ unitDir: entry.unitDir, axis: 'method', value: '', status: 'not-reported', evidenceIds: [], comparability: 'unknown', comparabilityReason: '' }] } })
    await click(tree, 'paperMatrixAdd (')
    expect(api.paperMatrixUpdate.mock.calls[2][0].patch).toEqual({ addUnitDirs: [entry.unitDir] })
  })

  it('keeps saved matrix controls compact and only adds axes after explicit confirmation', async () => {
    tree = await render(createElement(PaperMatrixWorkspace, { workspaceRoot: '/library', selected: [entry], onClose: vi.fn() }))
    expect(tree.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
    expect(button(tree, 'paperMatrixAxes').props['aria-expanded']).toBe(false)
    await click(tree, 'paperMatrixAxes')
    expect(button(tree, 'paperMatrixAxes').props['aria-expanded']).toBe(true)
    expect(tree.root.findAllByProps({ type: 'checkbox' })).toHaveLength(12)
    expect(api.paperMatrixUpdate).not.toHaveBeenCalled()
    await click(tree, 'paperMatrixAddAxes')
    expect(api.paperMatrixUpdate.mock.calls[0][0]).toMatchObject({ matrixId: matrix.id, expectedRevision: 1,
      patch: { addAxes: ['task', 'method', 'dataset', 'metric', 'result', 'conditions', 'limitations'] } })
    expect(tree.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
    expect(tree.root.findByProps({ 'data-testid': 'paper-matrix-table-scroll' }).props.className).toContain('overflow-auto')
    expect(tree.root.findAllByType('th')[0].props.className).toContain('sticky left-0 top-0')
  })

  it('refuses to combine matrices and evidence from different revisions', async () => {
    api.paperEvidenceRead.mockResolvedValue({ ok: true, revision: 2, items: [evidence] })
    tree = await render(createElement(PaperMatrixWorkspace, { workspaceRoot: '/library', selected: [entry], onClose: vi.fn() }))
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['Evidence changed while loading. Reload saved data.'])
    expect(tree.root.findAllByType('td')).toHaveLength(0)
    expect(api.paperMatrixUpdate).not.toHaveBeenCalled()
  })

  it('loads a new workspace even when the previous workspace read is still pending', async () => {
    const pending = deferred<unknown>()
    api.paperMatricesRead.mockImplementationOnce(() => pending.promise)
    tree = await render(createElement(PaperMatrixWorkspace, { workspaceRoot: '/library', selected: [entry], onClose: vi.fn() }))
    await act(async () => tree!.update(createElement(PaperMatrixWorkspace, { workspaceRoot: '/other', selected: [], onClose: vi.fn() })))
    expect(api.paperMatricesRead).toHaveBeenCalledWith({ workspaceRoot: '/other' })
    await act(async () => pending.resolve({ ok: true, revision: 1, matrices: [{ ...matrix, title: 'Stale matrix' }] }))
    expect(nodeText(tree.root)).not.toContain('Stale matrix')
  })
})
