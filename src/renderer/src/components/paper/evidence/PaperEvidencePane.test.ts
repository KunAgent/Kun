import { createElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperEvidenceCard, PaperEvidencePane } from './PaperEvidencePane'
import { button, change, click, deferred, evidence, nodeText, render } from './paper-evidence-test-support'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../paper/paper-evidence-actions', () => ({
  inspectPaperEvidence: vi.fn(), paperEvidenceCitation: () => 'citation'
}))

let tree: ReactTestRenderer | undefined
let api: { paperEvidenceRead: ReturnType<typeof vi.fn>; paperEvidenceUpdate: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  api = {
    paperEvidenceRead: vi.fn(async () => ({ ok: true, revision: 1, items: [evidence] })),
    paperEvidenceUpdate: vi.fn(async () => ({ ok: true, revision: 2, items: [evidence] }))
  }
  vi.stubGlobal('window', { kunGui: api })
})
afterEach(async () => { await act(async () => tree?.unmount()); tree = undefined; vi.unstubAllGlobals() })

describe('PaperEvidenceCard manual judgments', () => {
  it('saves only editable fields, preserves original qualifiers, and undoes the last successful edit', async () => {
    const onSave = vi.fn(async () => undefined)
    tree = await render(createElement(PaperEvidenceCard, { evidence, onSave, onSource: vi.fn() }))
    expect(tree.root.findAllByType('textarea')).toHaveLength(0)
    expect(nodeText(tree.root.findByType('blockquote'))).toContain(evidence.originalQuote)
    await click(tree, 'paperEvidenceEdit')
    await change(tree.root.findAllByType('textarea')[0], 'A revised user interpretation')
    await change(tree.root.findAllByType('select')[1], 'user-verified')
    await click(tree, 'paperEvidenceSaveEdits')
    expect(onSave).toHaveBeenLastCalledWith({ interpretation: 'A revised user interpretation', conditions: evidence.conditions,
      question: evidence.question, claimKind: 'user-judgment', verification: 'user-verified' })
    expect(nodeText(tree.root)).toContain(evidence.originalQuote)
    expect(evidence.verification).toBe('unverified')
    expect(tree.root.findAllByType('textarea')).toHaveLength(0)
    expect(nodeText(tree.root.findByProps({ 'data-testid': 'paper-evidence-semantic-status' }))).toBe('paperEvidence_user-verified')
    await click(tree, 'paperEvidenceUndo')
    expect(onSave).toHaveBeenLastCalledWith({ interpretation: evidence.interpretation, conditions: evidence.conditions,
      question: evidence.question, claimKind: 'user-judgment', verification: 'unverified' })
  })

  it('coalesces rapid save clicks and retains a failed draft without a false undo entry', async () => {
    const pending = deferred<void>()
    const onSave = vi.fn(() => pending.promise)
    tree = await render(createElement(PaperEvidenceCard, { evidence, onSave, onSource: vi.fn() }))
    await click(tree, 'paperEvidenceEdit')
    await change(tree.root.findAllByType('textarea')[0], 'Unsaved draft')
    const save = button(tree, 'paperEvidenceSaveEdits').props.onClick
    await act(async () => { save(); save() })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(button(tree, 'paperEvidenceSource').props.disabled).toBe(true)
    await act(async () => pending.reject(new Error('Revision conflict: reload saved data')))
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['Revision conflict: reload saved data'])
    expect(tree.root.findAllByType('textarea')[0].props.value).toBe('Unsaved draft')
    expect(button(tree, 'paperEvidenceUndo').props.disabled).toBe(true)
  })

  it('shows legacy, quote-match and incomplete-text warnings without claiming semantic verification', async () => {
    tree = await render(createElement(PaperEvidenceCard, { evidence: { ...evidence,
      mechanical: { ...evidence.mechanical, versionBinding: 'legacy-unbound', quoteMatch: 'not-found', textPartial: true } },
    onSave: vi.fn(), onSource: vi.fn() }))
    const text = nodeText(tree.root)
    expect(text).toContain('paperEvidence_legacy-unbound')
    expect(text).toContain('paperEvidence_not-found')
    expect(text).toContain('paperEvidencePartial')
    const visibleSourceSummary = nodeText(tree.root.findByType('summary'))
    expect(visibleSourceSummary).toContain('paperEvidence_legacy-unbound')
    expect(visibleSourceSummary).toContain('paperEvidencePartial')
    expect(tree.root.findAllByType('select')).toHaveLength(0)
    expect(nodeText(tree.root.findByProps({ 'data-testid': 'paper-evidence-semantic-status' }))).toBe('paperEvidence_unverified')
  })

  it('cancels a draft without saving and reopens the last saved judgment', async () => {
    const onSave = vi.fn(async () => undefined)
    tree = await render(createElement(PaperEvidenceCard, { evidence, onSave, onSource: vi.fn() }))
    await click(tree, 'paperEvidenceEdit')
    await change(tree.root.findAllByType('textarea')[0], 'Discard this draft')
    await change(tree.root.findAllByType('select')[1], 'user-verified')
    await click(tree, 'cancel')
    expect(onSave).not.toHaveBeenCalled()
    expect(tree.root.findAllByType('textarea')).toHaveLength(0)
    expect(nodeText(tree.root)).not.toContain('Discard this draft')
    await click(tree, 'paperEvidenceEdit')
    expect(tree.root.findAllByType('textarea')[0].props.value).toBe(evidence.interpretation)
    expect(tree.root.findAllByType('select')[1].props.value).toBe('unverified')
  })

  it('shows the exact source warning and never changes the editable evidence on navigation failure', async () => {
    const warning = 'The PDF changed since this evidence was captured. The saved page anchor is stale.'
    const onSave = vi.fn()
    tree = await render(createElement(PaperEvidenceCard, { evidence, onSave, onSource: vi.fn(async () => { throw new Error(warning) }) }))
    await click(tree, 'paperEvidenceSource')
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual([warning])
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('PaperEvidencePane loading and scope changes', () => {
  it('surfaces a corrupt store and never creates replacement evidence', async () => {
    api.paperEvidenceRead.mockResolvedValue({ ok: false, code: 'corrupt-store', message: 'Stored evidence is malformed. Restore or repair it before editing.' })
    tree = await render(createElement(PaperEvidencePane, { workspaceRoot: '/library', unitDir: 'papers/a' }))
    expect(tree.root.findByProps({ role: 'alert' }).children).toEqual(['Stored evidence is malformed. Restore or repair it before editing.'])
    expect(api.paperEvidenceUpdate).not.toHaveBeenCalled()
  })

  it('abandons stale reads when switching papers', async () => {
    const pending = deferred<unknown>()
    api.paperEvidenceRead.mockImplementationOnce(() => pending.promise).mockResolvedValueOnce({ ok: true, revision: 2, items: [] })
    tree = await render(createElement(PaperEvidencePane, { workspaceRoot: '/library', unitDir: 'papers/a' }))
    await act(async () => tree!.update(createElement(PaperEvidencePane, { workspaceRoot: '/library', unitDir: 'papers/b' })))
    await act(async () => pending.resolve({ ok: true, revision: 1, items: [evidence] }))
    expect(tree.root.findAllByProps({ 'data-testid': 'paper-evidence-card' })).toHaveLength(0)
  })

  it('preserves unsaved drafts on other cards after one evidence record is saved', async () => {
    const other = { ...evidence, id: 'evidence-b', interpretation: 'Second saved interpretation' }
    api.paperEvidenceRead.mockResolvedValue({ ok: true, revision: 1, items: [evidence, other] })
    api.paperEvidenceUpdate.mockResolvedValue({ ok: true, revision: 2, items: [{ ...evidence, interpretation: 'First edited', updatedAt: 'later' }, other] })
    tree = await render(createElement(PaperEvidencePane, { workspaceRoot: '/library' }))
    const editButtons = tree.root.findAll((node) => node.type === 'button' && nodeText(node) === 'paperEvidenceEdit')
    await act(async () => { editButtons.forEach((node) => node.props.onClick()) })
    await change(tree.root.findAllByType('textarea')[3], 'Second unsaved draft')
    await change(tree.root.findAllByType('textarea')[0], 'First edited')
    await act(async () => tree!.root.findAll((node) => node.type === 'button' && nodeText(node) === 'paperEvidenceSaveEdits')[0].props.onClick())
    expect(tree.root.findAllByType('textarea')).toHaveLength(3)
    expect(tree.root.findAllByType('textarea')[0].props.value).toBe('Second unsaved draft')
  })

  it('does not apply an old paper save response after navigating to a different paper', async () => {
    const pending = deferred<unknown>()
    api.paperEvidenceUpdate.mockImplementation(() => pending.promise)
    tree = await render(createElement(PaperEvidencePane, { workspaceRoot: '/library', unitDir: 'papers/a' }))
    await click(tree, 'paperEvidenceEdit')
    await click(tree, 'paperEvidenceSaveEdits')
    api.paperEvidenceRead.mockResolvedValue({ ok: true, revision: 3, items: [] })
    await act(async () => tree!.update(createElement(PaperEvidencePane, { workspaceRoot: '/library', unitDir: 'papers/b' })))
    await act(async () => pending.resolve({ ok: true, revision: 2, items: [evidence] }))
    expect(tree.root.findAllByProps({ 'data-testid': 'paper-evidence-card' })).toHaveLength(0)
  })
})
