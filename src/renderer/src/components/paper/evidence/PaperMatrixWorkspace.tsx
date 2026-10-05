import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PAPER_MATRIX_AXES, type PaperComparisonMatrix, type PaperEvidence, type PaperMatrixAxis, type PaperMatrixCell, type PaperMatrixPatch } from '@shared/paper/paper-evidence-types'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { paperMatrixMarkdown } from '../../../paper/paper-evidence-actions'
import { PaperMatrixCellEditor } from './PaperMatrixCellEditor'
import { evidenceButton, evidenceInput, PaperEvidencePane } from './PaperEvidencePane'

export function PaperMatrixWorkspace({ workspaceRoot, selected, onClose }: {
  workspaceRoot: string
  selected: PaperLibraryEntry[]
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [matrices, setMatrices] = useState<PaperComparisonMatrix[]>([])
  const [evidence, setEvidence] = useState<PaperEvidence[]>([])
  const [revision, setRevision] = useState(0)
  const [matrixId, setMatrixId] = useState('')
  const [title, setTitle] = useState('')
  const [axes, setAxes] = useState<PaperMatrixAxis[]>(['task', 'method', 'dataset', 'metric', 'result', 'conditions', 'limitations'])
  const [editing, setEditing] = useState<PaperMatrixCell | null>(null)
  const [undo, setUndo] = useState<{ matrixId: string; patch: PaperMatrixPatch } | null>(null)
  const [tab, setTab] = useState<'matrix' | 'evidence'>('matrix')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const generation = useRef(0)
  const activeRoot = useRef(workspaceRoot)
  activeRoot.current = workspaceRoot
  const operation = useRef(0)
  const current = matrices.find((matrix) => matrix.id === matrixId)
  const load = async (): Promise<void> => {
    const token = ++generation.current
    const result = await window.kunGui.paperMatricesRead({ workspaceRoot })
    const cards = await window.kunGui.paperEvidenceRead({ workspaceRoot })
    if (token !== generation.current) return
    if (!result.ok) throw new Error(result.message)
    if (!cards.ok) throw new Error(cards.message)
    // Both endpoints share a revision. Concurrent edits require an explicit retry.
    if (result.revision !== cards.revision) throw new Error('Evidence changed while loading. Reload saved data.')
    setMatrices(result.matrices)
    setEvidence(cards.items)
    setRevision(result.revision)
    setMatrixId((id) => result.matrices.some((matrix) => matrix.id === id) ? id : result.matrices[0]?.id ?? '')
  }
  const act = async (action: () => Promise<void>): Promise<void> => {
    if (lock.current) return
    lock.current = true
    const token = ++operation.current
    setBusy(true)
    setError('')
    try { await action() } catch (cause) { if (token === operation.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (token === operation.current) { lock.current = false; setBusy(false) } }
  }
  useEffect(() => {
    operation.current += 1
    lock.current = false
    setMatrices([])
    setEvidence([])
    setMatrixId('')
    setUndo(null)
    setEditing(null)
    void act(load)
    return () => { generation.current += 1; operation.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot])
  const update = async (patch: PaperMatrixPatch): Promise<void> => {
    if (!current) return
    const result = await window.kunGui.paperMatrixUpdate({ workspaceRoot, matrixId: current.id, expectedRevision: revision, patch })
    if (activeRoot.current !== workspaceRoot) return
    if (!result.ok) throw new Error(result.message)
    if (patch.cells) {
      const before = current.cells.filter((cell) => patch.cells?.some((next) => next.unitDir === cell.unitDir && next.axis === cell.axis))
      setUndo({ matrixId: current.id, patch: { cells: before.map(({ updatedAt: _updatedAt, ...cell }) => cell) } })
    }
    setMatrices(result.matrices)
    setRevision(result.revision)
  }
  const create = async (): Promise<void> => {
    const result = await window.kunGui.paperMatrixCreate({ workspaceRoot, title: title.trim() || t('paperMatrixTitle'), unitDirs: selected.map((entry) => entry.unitDir), axes, expectedRevision: revision })
    if (activeRoot.current !== workspaceRoot) return
    if (!result.ok) throw new Error(result.message)
    setMatrices(result.matrices)
    setRevision(result.revision)
    const created = result.matrices.find((matrix) => !matrices.some((old) => old.id === matrix.id))
    if (created) setMatrixId(created.id)
    setTitle('')
  }
  return <section data-testid="paper-matrix-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col bg-ds-main">
    <header className="flex flex-wrap items-center gap-2 border-b border-ds-border-muted p-3">
      <button type="button" className={evidenceButton} onClick={onClose}>{t('back')}</button>
      <h1 className="text-sm font-semibold text-ds-ink">{t('paperMatrixTitle')}</h1>
      <div role="tablist" className="ml-auto flex gap-1">
        <button type="button" role="tab" aria-selected={tab === 'matrix'} className={evidenceButton} onClick={() => { setTab('matrix'); void act(load) }}>{t('paperMatrixTitle')}</button>
        <button type="button" role="tab" aria-selected={tab === 'evidence'} className={evidenceButton} onClick={() => setTab('evidence')}>{t('paperEvidenceTitle')}</button>
      </div>
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
      <p className="text-xs text-ds-muted">{t('paperReadingLocalControls')}</p>
      {tab === 'evidence' ? <PaperEvidencePane workspaceRoot={workspaceRoot} /> : <>
        <p className="text-xs text-ds-muted">{t('paperMatrixNoRank')}</p>
        {error ? <p role="alert" className="text-xs text-red-500">{error}</p> : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-44 flex-1 text-xs text-ds-muted">{t('paperMatrixChoose')}<select aria-label={t('paperMatrixChoose')} className={evidenceInput} value={matrixId} onChange={(event) => { setMatrixId(event.target.value); setUndo(null) }}>
            <option value="">{t('paperMatrixNew')}</option>{matrices.map((matrix) => <option key={matrix.id} value={matrix.id}>{matrix.title}</option>)}
          </select></label>
          <button type="button" className={evidenceButton} disabled={busy} onClick={() => void act(load)}>{t('paperEvidenceReload')}</button>
          {current ? <button type="button" className={evidenceButton} disabled={busy || !selected.length} onClick={() => void act(() => update({ addUnitDirs: selected.map((entry) => entry.unitDir) }))}>{t('paperMatrixAdd')} ({selected.length})</button> : null}
          {current ? <button type="button" className={evidenceButton} disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(paperMatrixMarkdown(current, evidence)))}>{t('paperMatrixExport')}</button> : null}
          {undo?.matrixId === matrixId ? <button type="button" className={evidenceButton} disabled={busy} onClick={() => void act(() => update(undo.patch))}>{t('paperEvidenceUndo')}</button> : null}
        </div>
        <fieldset className="rounded-lg border border-ds-border-muted p-2"><legend className="px-1 text-xs text-ds-muted">{t('paperMatrixAxes')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{PAPER_MATRIX_AXES.map((axis) => <label key={axis} className="flex items-center gap-1.5 text-xs text-ds-muted"><input type="checkbox" checked={axes.includes(axis)} onChange={(event) => setAxes(event.target.checked ? [...axes, axis] : axes.filter((item) => item !== axis))} />{t(`paperMatrixAxis_${axis}`)}</label>)}</div>
        </fieldset>
        {current ? <button type="button" className={evidenceButton} disabled={busy || !axes.length} onClick={() => void act(() => update({ addAxes: axes }))}>{t('paperMatrixAddAxes')}</button> : <div className="flex flex-wrap gap-2">
          <label className="min-w-48 flex-1 text-xs text-ds-muted">{t('paperMatrixName')}<input maxLength={200} className={evidenceInput} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <button type="button" className={evidenceButton} disabled={busy || !axes.length || !selected.length} onClick={() => void act(create)}>{t('paperMatrixCreate')} ({selected.length})</button>
        </div>}
        {current ? <div className="overflow-auto rounded-lg border border-ds-border-muted"><table className="w-full border-collapse text-left text-xs"><thead><tr><th className="sticky left-0 z-10 min-w-44 bg-ds-card p-3">{t('paperMatrixTitle')}</th>{current.axes.map((axis) => <th key={axis} className="min-w-48 bg-ds-subtle p-3 text-ds-ink">{t(`paperMatrixAxis_${axis}`)}</th>)}</tr></thead>
          <tbody>{current.rows.map((row) => <tr key={row.unitDir}><th className="sticky left-0 z-10 max-w-56 border-t border-ds-border-muted bg-ds-card p-3 font-medium text-ds-ink"><span>{row.title}</span><span className="mt-1 block text-[11px] text-ds-muted">{row.citeKey}</span></th>{current.axes.map((axis) => {
            const cell = current.cells.find((item) => item.unitDir === row.unitDir && item.axis === axis)
            return <td key={axis} className="border-l border-t border-ds-border-muted p-1 align-top"><button type="button" className="min-h-20 w-full rounded p-2 text-left hover:bg-ds-hover" disabled={busy || !cell} onClick={() => cell && setEditing(cell)}>
              <span className="block whitespace-pre-wrap break-words text-ds-ink">{cell?.status === 'reported' ? cell.value : t('paperMatrixUnknown')}</span>
              <span className="mt-2 block text-[11px] text-ds-muted">{t(`paperMatrix_${cell?.comparability ?? 'unknown'}`)}</span>
              {cell?.evidenceIds.length ? <span className="block text-[11px] text-accent">{t('paperMatrixEvidence')} · {cell.evidenceIds.length}</span> : null}
            </button></td>
          })}</tr>)}</tbody></table></div> : <p className="text-xs text-ds-muted">{t('paperMatrixEmpty')}</p>}
      </>}
    </div>
    {editing ? <PaperMatrixCellEditor workspaceRoot={workspaceRoot} cell={editing} evidence={evidence} onSave={update} onClose={() => setEditing(null)} /> : null}
  </section>
}
