import { useEffect, useRef, useState, type ReactElement } from 'react'
import { ArrowLeft, Check, ChevronDown, Copy, Info, Link2, Plus, RefreshCw, SlidersHorizontal, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PAPER_MATRIX_AXES, type PaperComparisonMatrix, type PaperEvidence, type PaperMatrixAxis, type PaperMatrixCell, type PaperMatrixPatch } from '@shared/paper/paper-evidence-types'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import { paperMatrixMarkdown } from '../../../paper/paper-evidence-actions'
import { PaperMatrixCellEditor } from './PaperMatrixCellEditor'
import { evidenceButton, evidenceInput, evidencePrimaryButton, PaperEvidencePane } from './PaperEvidencePane'

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
  const [showAxes, setShowAxes] = useState(false)
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
    setShowAxes(false)
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
    setShowAxes(false)
  }
  const iconButton = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-accent disabled:opacity-40'
  return <section data-testid="paper-matrix-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col bg-ds-main">
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-ds-border-muted px-3 py-2">
      <button type="button" className={iconButton} title={t('back')} onClick={onClose}><ArrowLeft size={16} /><span className="sr-only">{t('back')}</span></button>
      <h1 className="text-[13px] font-medium text-ds-ink">{t('paperMatrixTitle')}</h1>
      <div role="tablist" aria-label={t('paperMatrixTitle')} className="ml-auto flex items-center gap-0.5 rounded-lg bg-ds-subtle p-0.5">
        {(['matrix', 'evidence'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={`rounded-md px-2.5 py-1.5 text-[11px] transition ${tab === value ? 'bg-ds-card font-medium text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`} onClick={() => { setTab(value); if (value === 'matrix') void act(load) }}>{t(value === 'matrix' ? 'paperMatrixTitle' : 'paperEvidenceTitle')}</button>)}
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      {tab === 'evidence' ? <div className="mx-auto w-full max-w-3xl"><PaperEvidencePane workspaceRoot={workspaceRoot} /></div> : <>
        {error ? <p role="alert" className="rounded-lg bg-ds-danger-soft px-3 py-2 text-xs text-ds-danger">{error}</p> : null}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <label className="sr-only" htmlFor="paper-matrix-picker">{t('paperMatrixChoose')}</label>
            <select id="paper-matrix-picker" aria-label={t('paperMatrixChoose')} className="h-9 w-full max-w-md rounded-lg border border-ds-border-muted bg-ds-card px-2.5 text-[13px] font-medium text-ds-ink outline-none focus:border-accent" value={matrixId} disabled={busy} onChange={(event) => { setMatrixId(event.target.value); setUndo(null); setShowAxes(false) }}>
              <option value="">{t('paperMatrixNew')}</option>{matrices.map((matrix) => <option key={matrix.id} value={matrix.id}>{matrix.title}</option>)}
            </select>
          </div>
          {current ? <button type="button" className={`${evidenceButton} ${showAxes ? 'bg-ds-subtle' : ''}`} aria-expanded={showAxes} aria-controls="paper-matrix-axes" onClick={() => setShowAxes(!showAxes)}><SlidersHorizontal size={13} />{t('paperMatrixAxes')}<ChevronDown size={12} className={`transition-transform ${showAxes ? 'rotate-180' : ''}`} /></button> : null}
          <div className="flex items-center gap-0.5">
            <button type="button" className={iconButton} title={t('paperEvidenceReload')} disabled={busy} onClick={() => void act(load)}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /><span className="sr-only">{t('paperEvidenceReload')}</span></button>
            {current ? <button type="button" className={iconButton} title={t('paperMatrixExport')} disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(paperMatrixMarkdown(current, evidence)))}><Copy size={14} /><span className="sr-only">{t('paperMatrixExport')}</span></button> : null}
            {undo?.matrixId === matrixId ? <button type="button" className={iconButton} title={t('paperEvidenceUndo')} disabled={busy} onClick={() => void act(() => update(undo.patch))}><Undo2 size={14} /><span className="sr-only">{t('paperEvidenceUndo')}</span></button> : null}
          </div>
        </div>
        {(showAxes || !current) ? <div id="paper-matrix-axes" className="shrink-0 space-y-4 rounded-xl border border-ds-border-muted bg-ds-card p-4">
          {!current ? <label className="block space-y-1.5 text-xs text-ds-muted"><span>{t('paperMatrixName')}</span><input maxLength={200} className={evidenceInput} value={title} onChange={(event) => setTitle(event.target.value)} /></label> : null}
          <fieldset disabled={busy}>
            <legend className="mb-2.5 text-[11px] font-medium text-ds-muted">{t('paperMatrixAxes')}</legend>
            <div className="flex flex-wrap gap-2">{PAPER_MATRIX_AXES.map((axis) => <label key={axis} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition ${axes.includes(axis) ? 'border-accent-tint/20 bg-accent-tint/5 text-ds-ink' : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover'}`}><input type="checkbox" className="h-3 w-3 accent-[var(--ds-accent)]" checked={axes.includes(axis)} onChange={(event) => setAxes(event.target.checked ? [...axes, axis] : axes.filter((item) => item !== axis))} />{t(`paperMatrixAxis_${axis}`)}</label>)}</div>
          </fieldset>
          <div className="flex justify-end">{current ? <button type="button" className={evidencePrimaryButton} disabled={busy || !axes.length} onClick={() => void act(async () => { await update({ addAxes: axes }); setShowAxes(false) })}><Plus size={13} />{t('paperMatrixAddAxes')}</button> : <button type="button" className={evidencePrimaryButton} disabled={busy || !axes.length || !selected.length} onClick={() => void act(create)}><Plus size={13} />{t('paperMatrixCreate')} ({selected.length})</button>}</div>
        </div> : null}
        {current ? <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] tabular-nums text-ds-muted">{t('paperMatrixSummary', { papers: current.rows.length, axes: current.axes.length })}</p>
            <button type="button" className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40" disabled={busy || !selected.length} onClick={() => void act(() => update({ addUnitDirs: selected.map((entry) => entry.unitDir) }))}><Plus size={13} />{t('paperMatrixAdd')} ({selected.length})</button>
          </div>
          <div className="min-h-40 flex-1 overflow-auto rounded-xl border border-ds-border-muted bg-ds-card" data-testid="paper-matrix-table-scroll">
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead><tr>
                <th scope="col" className="sticky left-0 top-0 z-30 min-w-40 border-b border-r border-ds-border-muted bg-ds-subtle px-4 py-3 text-[11px] font-medium text-ds-muted">{t('paperMatrixPapers')}</th>
                {current.axes.map((axis) => <th scope="col" key={axis} className="sticky top-0 z-20 min-w-52 border-b border-ds-border-muted bg-ds-subtle px-4 py-3 text-[11px] font-medium text-ds-muted">{t(`paperMatrixAxis_${axis}`)}</th>)}
              </tr></thead>
              <tbody>{current.rows.map((row, index) => <tr key={row.unitDir}>
                <th scope="row" className="sticky left-0 z-10 w-48 min-w-40 max-w-56 border-b border-r border-ds-border-muted bg-ds-card px-4 py-4 align-top font-normal">
                  <span className="mb-1.5 block text-[10px] tabular-nums text-ds-faint">{String(index + 1).padStart(2, '0')}</span>
                  <span className="line-clamp-3 break-words text-xs font-medium leading-relaxed text-ds-ink" title={row.title}>{row.title}</span>
                  <span className="mt-1.5 block truncate text-[10px] text-ds-faint" title={row.citeKey}>{row.citeKey}</span>
                </th>
                {current.axes.map((axis) => {
                  const cell = current.cells.find((item) => item.unitDir === row.unitDir && item.axis === axis)
                  const reported = cell?.status === 'reported'
                  return <td key={axis} className="border-b border-r border-ds-border-muted p-1.5 align-top last:border-r-0"><button type="button" aria-label={`${row.title} · ${t(`paperMatrixAxis_${axis}`)} · ${reported ? cell.value : t('paperMatrixUnknown')}`} className="group min-h-24 w-full rounded-lg p-2.5 text-left transition hover:bg-ds-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40" disabled={busy || !cell} onClick={() => cell && setEditing(cell)}>
                    <span className={`block whitespace-pre-wrap break-words text-xs leading-relaxed ${reported ? 'text-ds-ink' : 'text-ds-faint'}`}>{reported ? cell.value : t('paperMatrixUnknown')}</span>
                    {reported ? <div className="mt-3 space-y-1.5">
                      <span className={`flex items-start gap-1 text-[10px] leading-relaxed ${cell.comparability === 'not-comparable' ? 'text-amber-700 dark:text-amber-300' : 'text-ds-muted'}`} title={cell.comparabilityReason || undefined}>{cell.comparability === 'comparable' ? <Check size={12} className="mt-0.5 shrink-0" /> : null}{t(`paperMatrix_${cell.comparability}`)}</span>
                      {cell.evidenceIds.length ? <span className="inline-flex items-center gap-1 rounded-md bg-accent-tint/5 px-1.5 py-0.5 text-[10px] text-accent"><Link2 size={11} />{t('paperMatrixEvidence')} · {cell.evidenceIds.length}</span> : null}
                    </div> : null}
                  </button></td>
                })}
              </tr>)}</tbody>
            </table>
          </div>
          <p className="flex shrink-0 items-start gap-1.5 text-[10px] leading-relaxed text-ds-muted"><Info size={12} className="mt-0.5 shrink-0" />{t('paperMatrixNoRank')}</p>
        </> : <p className="rounded-xl border border-dashed border-ds-border-muted px-5 py-8 text-center text-xs leading-relaxed text-ds-muted">{t('paperMatrixEmpty')}</p>}
      </>}
      <p className="shrink-0 text-[10px] leading-relaxed text-ds-faint">{t('paperReadingLocalControls')}</p>
    </div>
    {editing ? <PaperMatrixCellEditor workspaceRoot={workspaceRoot} cell={editing} evidence={evidence} onSave={update} onClose={() => setEditing(null)} /> : null}
  </section>
}
